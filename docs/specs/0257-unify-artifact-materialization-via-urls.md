# Unify artifact materialization via URLs (issue #257)

Implementation plan for [SquadRules/mcp issue #257](https://github.com/SquadRules/mcp/issues/257) (revised design, 2026-11-02). This is a planning document; it lands no code. It supersedes the STDIO `inline_base64` carrier decided in ADR 0039 and revisits ADR 0033 section 6.

## Summary

Replace the STDIO `export` + `inline_base64` + `$B64` materialization flow with a transport-neutral URL contract.

- STDIO: the running server writes verified artifact bytes to a private cache under `os.tmpdir()` and returns an absolute `file://` URL (`pathToFileURL`).
- HTTP: unchanged short-lived capability URL.
- Both feed one shared builder that emits an exact `curl`-to-staging, verify SHA-256, `chmod 700`, atomic-rename command the agent runs verbatim.

Artifact identity is the UUID, not the slug. No CLI process, no version matching, no second LanceDB connection, and no artifact bytes in MCP context. The README `npx -y @squadrules/mcp@latest` config is preserved (no global-install recommendation).

All implementation work runs in an isolated linked worktree per `.qoder/rules/task-isolation.md`.

## Superseding ADR

- Add `docs/adr/0040-*.md`, numbered above upstream's max at branch time (list `docs/adr/0*` on `origin/main`). It supersedes ADR 0039 and ADR 0033 section 6, and references ADR 0022 (embedded-LanceDB cache skip), ADR 0013 (shared store), ADR 0015 (CLI local backend), and issue #231.
- Record the URL-unification decision, the `file://` shared-filesystem MVP policy with actionable diagnostics for isolated filesystems, the byte-exactness rationale, and the portable-digest decision.
- Edit only the Status line of `docs/adr/0039-*.md` to `Superseded by 0040`; never rewrite an accepted ADR body.
- Update `docs/adr/README.md`: flip the 0039 index row Status and add the 0040 row (Decision, Status, Reopens when).

## New STDIO local artifact cache provider

New module `src/tools/artifact-local-cache.ts` (pure Node `fs`; no CLI, no second backend):

- Cache root under `os.tmpdir()`, per-user/process, created `0700` (for example `squadrules-artifact-cache-<uid>`).
- Filename `<artifact_uuid>-<sha256>.<ext>`; `ext` sanitized from `relative_path` or `content_type`.
- Write bytes from `AdapterArtifactMetadata.text` (already carried by `listAdapterArtifacts`) via `Buffer.from(text, 'utf8')`; verify `sha256Hex(text) === artifact.sha256` (reuse `src/tools/skill-export/sha256.ts`) before publish; on mismatch throw and fail closed.
- Atomic publish: write a `0600` temp file in the cache dir, `fsync`, then rename into place. Dedup: if `<uuid>-<sha256>.<ext>` already exists and its digest matches, reuse it without rewriting.
- Bounded retention: TTL (reuse `SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC`) plus an LRU entry cap; prune expired entries on each activate; never delete on process start, because the tmpdir outlives the process.
- Return `pathToFileURL(absPath).href`.

## Materialize command builder (transport-neutral)

Rewrite `src/tools/artifact-materialize-command.ts`:

- New input `{ url: string; relativePath: string; sha256: string }`; drop `transport`, `downloadUrl`, and `artifactUri`, since the command no longer branches by transport.
- New `MaterializeInstruction`: `{ method: 'url'; url; out; sha256; chmod: '700'; cmd }`. Remove `tool` and `arguments`. `out` stays `$SQUADRULES_LOCAL_ARTIFACT_DIR/<relativePath>`.
- `cmd` is one exact POSIX shell line that guards `${SQUADRULES_LOCAL_ARTIFACT_DIR:?...}` as non-empty, creates the destination parent, curls into a fresh private temp file inside the destination dir (`mktemp`), verifies the digest, applies `chmod 700`, and atomically renames staging into `out`. On any failure it exits nonzero, removes staging, leaves a previously verified destination untouched, and never chmods an unverified file. Chain every step with `&&`.
- Portable digest verification: a deterministic fallback chain with no platform assumption baked in. Prefer `sha256sum`, else `shasum -a 256`, else `openssl dgst -sha256`; compare the computed hex to the expected `sha256`.
- Centralized shell safety: add a single-quote escaper and use it for `<url>`; keep `out` and staging double-quoted so the env var expands at runtime.

## Path safety grammar

Extend `src/tools/artifact-relative-path.ts` (or a validator used by the builder) to reject shell metacharacters in `relative_path` — `"`, `'`, backtick, `$`, `\`, and control/newline chars — in addition to the existing `..`, absolute, empty-segment, and length checks. Spaces and ordinary filename characters remain allowed. The destination must stay within the artifact root; guard against symlink and path redirection.

## activate wiring

In `src/tools/activate-artifacts.ts`:

- STDIO (`isStdio`): call the cache provider to obtain the `file://` URL; do not mint an HTTP capability (no unused token).
- HTTP: keep `mintExportArtifactDownloadCapability(...)`.
- Use UUID identity for source bytes and cache naming (`artifact.artifact_uuid`); keep `slug` for display only.
- Set the row `download_url` to the source URL (`file://` on STDIO, capability URL on HTTP) and `materialize` to the builder output.
- On cache-write or verify failure, surface it through the existing `artifactLoadError` path; never a silent empty `linked_artifacts`.

## Schema

In `src/tools/activate_schema.ts`, replace `materializeInstructionSchema` with a strict `{ method: z.literal('url'), url, out, sha256, chmod: z.literal('700'), cmd }`, and update the `.describe()` text so it implies no export call and no `$B64`. Update the `download_url` and `materialize` descriptions on `linkedArtifactSchema`, and the top-level `transport` description (drop the "use `squadrules export`" wording; STDIO is a `file://` URL now).

## Failure diagnostics

In `src/tools/shell-failure-diagnostics.ts`, replace the "on stdio, call the MCP export tool first and put its content in `$B64`" recovery text with guidance to run `materialize.cmd` verbatim — it curls the server-provided URL, verifies the digest, and publishes atomically.

## Docs

- Update the materialize prose in `src/embed-docs/tools/activate.md`, `src/embed-docs/tools/forward.md`, `src/embed-docs/mem/author-adapter.md`, and `src/embed-docs/mem/challenge-type-guide.md` to the single URL/curl contract; remove the base64, `$B64`, and export-first steps.
- `src/embed-docs/tools/export.md`: keep `source` and `inline_base64` documented as a supported read/compat API, but stop calling `inline_base64` "the materialization path".
- `docs/CLI.md`: adjust any materialize example that referenced the base64/export-first flow; the CLI `export --as source --to` form stays valid for manual reads.
- Leave the README MCP config unchanged (`npx -y @squadrules/mcp@latest`).
- Regenerate `src/resources/embedded-mcp-resources.ts` with the build (tracked, build-generated; never hand-edit).

## Tests

- Rewrite `tests/unit/artifact-materialize-command.test.ts` to assert the new object shape and to execute the emitted `cmd` for real against a `file://` URL backed by a temp source file and against an in-process HTTP listener. Cover byte-exactness (CRLF, non-ASCII, trailing newline, spaces in path), `chmod 700`, digest-mismatch failing closed, atomic publish preserving a previously verified destination on failure, unset/empty `SQUADRULES_LOCAL_ARTIFACT_DIR` failing closed, the macOS `shasum` fallback, and adversarial `relative_path`/URL values (`$(...)`, backticks, quotes, `$`) proving no injection.
- Add `tests/unit/artifact-local-cache.test.ts`: digest verification, dedup on identical uuid+sha, `0700` dir and `0600` file modes, atomic publish, TTL/LRU GC bound, and mismatch throwing.
- Update the `tests/unit/activate-slug-output-schema.test.ts` fixture to the new builder signature/shape and assert `cmd` contains `curl -fsS -o`.
- Update `tests/integration/write/squadrules-train-artifact.test.ts`: the HTTP assertions change from `materialize` `{ tool: 'export', arguments: { format: 'source' } }` to `{ method: 'url', chmod: '700' }` with `cmd` containing `curl -fsS -o` and the row `download_url`; keep the `source` + `inline_base64` export API assertions. Add a STDIO integration case asserting a real `file://` URL and a byte-exact file in the tmp cache.
- Add path-grammar unit tests for the new metacharacter rejections.
- Leave `export-schema-delivery.test.ts`, `export-source-format.test.ts`, and the `cli-local-backend-export-delivery` tests unchanged; the `inline_base64` API is preserved.
- Grep the whole `tests/` tree for retired literals (`$B64`, `tool: 'export'` in materialize, `sha256sum -c`) before pushing; the unit and CLUSTER lanes pin the shape independently.

## Preserved and out of scope

- The `export({ format: "source" })` readable path and the `source` + `inline_base64` API remain for compatibility, as does all `skill_zip` delivery behavior.
- HTTP capability TTL/expiry and no-logging behavior are unchanged; re-activate refreshes an expired URL.
- An optional MCP `resource_link` is not required and is skipped here; the URL plus `cmd` contract is authoritative.

## Assumptions

- Portable digest uses a deterministic `sha256sum`, then `shasum -a 256`, then `openssl dgst` fallback chain in `cmd`, with no server-side platform detection.
- The STDIO cache TTL reuses `SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC` with an LRU cap; the `file://` MVP explicitly supports the shared-filesystem case and fails with actionable diagnostics otherwise, with no speculative isolation detection.
- `AdapterArtifactMetadata.text` is the authoritative byte source and `artifact.sha256` is the digest over its UTF-8 bytes.
