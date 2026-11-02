# ADR 0039: Artifact materialize emits an exact command; source bytes ship as base64 on stdio

## Status

Accepted — decision taken 2026-11-01 and implemented by the accompanying change
([#231](https://github.com/SquadRules/mcp/issues/231)). Supersedes **Decision §6** of
[ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) (the transport-agnostic
`materialize` instruction introduced by PR
[#223](https://github.com/SquadRules/mcp/pull/223)); §1–§5 and §7 of that record stand.

## Context

ADR 0033 §6 replaced a shell command with a structured instruction, because the
command named `squadrules` CLI flags whose availability depends on the CLI version
the agent happens to have. The instruction told the agent to call the MCP `export`
tool with `format: "source"`, write the returned content to `out`, and match a
`sha256` issued by a different call.

That moved the hardest part of the job into the agent's reasoning. `export`
`format: "source"` returns the artifact as raw UTF-8 inside a JSON string and
carries no digest of its own. Reproducing exact bytes through host write tools —
editor write, shell heredoc, inline script — fails on trailing newlines, escaping,
CRLF versus LF, and line wrapping. Observed in a real run: an agent looped through
Write, heredoc, inline Python, and a base64 attempt for one gate-script artifact,
never matched the digest, and then proceeded to run the contract with an
**unverified** file. Byte-exactness is mechanical bookkeeping; the framework owns it
(AGENTS.md constitution 6: keep state handling, validation, and recovery in the
framework rather than asking agents to infer them).

The instruction was also **non-executable in HTTP mode**: the builder ignored its
`transport` argument and always emitted `arguments.uri = downloadUrl`, and in HTTP
that value is the minted capability URL (`/export/artifact/{opaque}`), which fails
the `export` tool's `ARTIFACT_URI_INPUT_REGEX`. The intended HTTP path was `curl` on
the separate `download_url` field, which the instruction never expressed.

## Decision

1. **`materialize.cmd` is an exact POSIX shell line, emitted per transport, and the
   agent runs it verbatim.** HTTP: `curl -fsS -o` against `download_url` — zero-copy,
   the listener serves the stored bytes. stdio/local: no listener exists, so the
   bytes come from the `export` tool as base64 and `cmd` decodes them
   (`printf '%s' "$B64" | base64 -d`). Both branches create the parent directory,
   verify with `sha256sum -c`, and `chmod 700`, chained with `&&` so a partial
   materialization cannot look like a completed one.
2. **`source` accepts `delivery: "inline_base64"`.** The `delivery` gate was
   restricted to `skill_zip`; widening it to `source` costs one condition and removes
   the whole byte-mangling failure class, because base64 uses a shell-safe alphabet
   and decoders tolerate whitespace and line wrapping. Raw text stays the default so
   agents can still *read* an artifact. ZIP is deliberately not used here: a
   container plus an extract step is the right shape for a multi-file `skill_zip`
   bundle, not for one script.
3. **Every `source` response carries `sha256`** — the digest of the bytes `content`
   holds. The agent can compare the digest from the *same* response instead of one
   from an earlier `activate`, which is what made a stale artifact and a mangled
   write indistinguishable.
4. **`materialize.arguments.uri` is always a valid `squadrules://artifact/{slug}`
   URI** on both transports, so the tool call is executable wherever it is emitted.
5. **The shape changed in place, with no compat union.** `materialize` had zero
   working consumers: the flow never completed end-to-end for any agent. That
   replaces-in-place allowance closes as soon as a consumer depends on the new shape.
6. **Reusing a shell line here does not reopen #223's objection.** That hazard was
   specific to `squadrules export --as source --to` — a CLI whose flags differ by
   installed version. `curl`, `base64`, `sha256sum`, `mkdir`, `chmod`, and `printf`
   are host-standard, and the command names no SquadRules binary.

## Consequences

### Positive

- One framework-issued line, so materialization succeeds or fails visibly; the
  agent no longer reasons about bytes.
- The digest and the payload arrive together, so "wrong version" and "I corrupted
  it" become different observations.
- The stdio path stops depending on a `squadrules` CLI at all, which is what #223
  was actually after.

### Negative

- GNU userland is assumed (`sha256sum`, `base64 -d`), as ADR 0033 §6 already logged
  for the verification step. A BSD userland without coreutils fails at the verify
  stage, not silently.
- On stdio the agent must set `B64` from the export response before running `cmd`;
  that is one more step than HTTP. `cmd` guards it with
  `${B64:?…}` so an unfilled variable stops with a named reason instead of writing
  an empty file.
- A capability URL expires, so an HTTP `cmd` is only valid for a short window after
  `activate`; re-run `activate` rather than editing the line.
- `content` of a base64 `source` response is no longer human-readable, so an agent
  that wants to *read* an artifact must omit `delivery`.

## Evidence

- `src/tools/artifact-materialize-command.ts` — the builder, the two `cmd` branches,
  and the `${B64:?…}` guard.
- `src/tools/export-source.ts` — `encodeSourcePayload`, digest over the stored UTF-8
  bytes (the same input `src/services/memory/store-artifact.ts` hashes at train
  time).
- `src/tools/export_schema.ts` — the widened `delivery` gate and the `sha256` output
  field; `src/tools/activate_schema.ts` — the strict `materialize` schema with `cmd`.
- `tests/unit/artifact-materialize-command.test.ts` — runs the emitted `cmd` for
  real: stdio decode against a CRLF + non-ASCII payload, HTTP against an in-process
  listener, mode 700, empty-`B64` refusal, and a wrong-digest failure.
- `tests/unit/export-schema-delivery.test.ts`,
  `tests/unit/export-source-format.test.ts` — schema gate and base64/digest round
  trip. `tests/unit/activate-slug-output-schema.test.ts` now builds its fixture with
  the real builder, so the strict output schema is checked against what `activate`
  emits rather than a hand-written copy.
- `tests/integration/write/squadrules-train-artifact.test.ts` — end-to-end over a
  real server: `activate` row, `curl`-based `cmd`, digest, and the base64 export
  decoding back to the trained body.
- Executed on the Termux host that wrote this record (Android, arm64, `dash`,
  coreutils `base64`/`sha256sum`, `curl`): 35 checks — the emitted `cmd` run as a
  shell, the `delivery` gate, the strict `activate` output schema against the real
  builder, and `executeExportSource` raw/base64 digests. The three unit files ran
  under `node:test` with a `.js`→`.ts` import shim, because this host holds no
  `node_modules`.
- Not run there: `tsc` type checking, repo-wide `eslint .`, the full Jest suite, and
  the integration test. Those are proven by CI on the PR head commit, per
  `.qoder/rules/low-memory-hosts.md`.

## Revisit condition

Reopen if a transport appears that has neither a downloadable capability URL nor an
in-process `export` tool — then the bytes need a different carrier. Also reopen if a
materialized artifact is found on disk that does not match its row's `sha256`, which
would mean `cmd` was bypassed rather than fixed. Track through
[#231](https://github.com/SquadRules/mcp/issues/231); do not rewrite this record.

## Related

- [ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) — Decision §6, superseded
  here; §1–§5 and §7 unchanged.
- [ADR 0024](0024-adapter-contract-verification-ladder.md) — materialization is a
  precondition of rung 1, and the digest check is rung-1 evidence, not a new rung.
