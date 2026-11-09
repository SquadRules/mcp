Register a new **adapter** from markdown (one H1 = one adapter; each verifiable segment ends with a fenced `json` block containing a top-level **`contract`** object).

**Input**

- `content` — full document string (optional if `source_adapter_uri` supplies content).
- `llm_model_id` — required model identifier string.
- `force_update` (optional) — replace an existing adapter with the same label.
- `expected_version` (optional) — compare-and-swap guard: the stored adapter version this document is based on. Requires an explicit `slug:` in frontmatter; a stale value fails with `VERSION_CONFLICT` before anything is written.
- `protocol_version` (optional) — version string (e.g. semver) stored on the adapter.
- `space` (optional) — `"personal"` or a full group path such as `"{{SQUADRULES_GROUP_SPACE_PATH_EXAMPLE}}"` (target space for the new adapter).
- `source_adapter_uri` (optional) — `squadrules://adapter/{uuid}` to **fork**: export that adapter’s markdown and **train** a **new** adapter (new ids). If you also pass `content`, that text is used instead of the export (customize before calling **`train`**).
- `mime` (optional) — content MIME type. Defaults to `text/markdown`.
- `artifact_name` (required when `mime` is not `text/markdown`) — file name shown when listing adapter artifacts. The artifact **slug** is derived from `relative_path` when that is set, otherwise from `artifact_name` (the whole name, extension included): lowercase, runs of non-alphanumeric characters collapse to one `-`, leading and trailing hyphens trimmed (`Isolation Guard.py` → `isolation-guard-py`). Pin a shorter slug with the `# squadrules-artifact:` header instead of relying on the derivation.
- `adapter_uri` (required when `mime` is not `text/markdown`) — `squadrules://adapter/{uuid}` or `squadrules://adapter/{slug}` target adapter for the artifact attachment. The adapter must already exist, so create it first and attach scripts in a second call.
- `relative_path` (optional, non-markdown artifacts only) — path relative to the skill bundle root (forward slashes; no `..` segments). When set, **`export`** **`skill_zip`** and **`skill_tree`** place the file at this path instead of the default **`artifacts/<sanitized artifact name>`** layout; `activate` materializes it at the same relative path. Contracts reference that path, not the artifact URI.
- `review_evidence` (required for adapter/markdown trains) — critic-loop verdict proof. Delegate a subagent to run critic-loop before **`train`**; do not review your own draft on the caller's thread. Provide the verdict file as proof. Object with `verdict_file` (absolute path), `exit_code` (must be 0), and `stdout` (line 1 must be PASS). Not required for artifact trains (non-markdown mime).

**Required structure (validated before store)**

- H1 title for the adapter.
- Optional frontmatter `slug:` pins the adapter's slug, and with it the `squadrules://adapter/<slug>` URI a later artifact `train` targets; without it the slug is derived from the H1 title.
- First H2: **Activation Patterns**.
- Last H2: **Reward Signal**.
- At least one fenced **` ```json `** block whose JSON has a top-level
  **`contract`** object.
- Contract fences must use the `json` language tag only (no plain ``` blocks holding contract JSON).
- Non-markdown artifacts (`mime` not `text/markdown`) are stored as adapter-linked artifacts instead of stored Markdown layers.

**Inheritance frontmatter (checked before the memory write).** Two optional keys, validated against the **parent's stored** frontmatter so a bad declaration never lands:

- `inherits:` — one parent slug. An array or comma list fails with `single_parent`.
- `override:` — the parent fields this document replaces (the only fields a child's own value wins on; anything the parent never declared is contributed regardless). A structural field (`contract`, `type`, `steps`, `chain_root`, `inherits`, `override`, `verdict`, `work_envelope`, `effective_contract`, `effective_contracts`) fails with `structural_override_forbidden`; a field the parent does not declare fails with `override_unknown_field`.
- A parent missing from the graph is **not** an error: the write succeeds and the response carries a `parent_missing` warning, which is what lets you train a chain bottom-up.

Errors fail the call with nothing stored; warnings are returned in `warnings[]` alongside `status: stored`. Merge semantics: `docs/adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md`.

**Declared anomaly (optional `anomaly:` frontmatter block).** A successful markdown train records the declaration as a graph anomaly discovered by this adapter, so the evidence outlives the call that produced it:

  ```yaml
  anomaly:
    reason: "parent caps retry at 3; this adapter retries 5"
    type: contradiction
    severity: medium
    field: retry_limit
    observed: "5"
    expected: "3"
  ```

`reason` (or `description`) becomes the anomaly text; `type` defaults to `contradiction`, `severity` to `medium`, `status` to `open`. This records a **claim to be confirmed**, never a verified fact — a digest proves the bytes, not the truth of the sentence.

**History and version guard.** Every successful markdown train appends an immutable snapshot (content, digest, actor, space, parent version, reason) to the graph. History is append-only: nothing is overwritten in place, and a re-train of the same bytes is recorded as a new snapshot labelled `restored` with the snapshot it matches.

- Pass `expected_version` to make the write a compare-and-swap; a moved adapter fails with `VERSION_CONFLICT` instead of being silently overwritten.
- Restore is a normal train, not a special mode: read the snapshot with **`export`** (`version: "<n>"`), then train that markdown back with `expected_version`.
- A train that would invalidate a stored descendant is rejected before the write, so a parent never lands half-updated. See `docs/adr/0045-graph-native-history-and-restore.md` and `docs/adr/0046-evidence-gated-evolution-proposals.md`.

**Artifact identity header (artifact bodies only).** Start the file with a
`squadrules-artifact` comment block to pin the artifact's identity instead of
deriving it from `artifact_name`. A leading `#!` shebang and blank lines before
the block are allowed; the block is consecutive `#`-comment lines of
`key: value`. Keys: `slug` (must match `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`) and
`version` (defaults to `1` when absent or blank).

  ```python
  #!/usr/bin/env python3
  # squadrules-artifact:
  # slug: isolation-guard
  # version: 3
  ```

A header slug changes **deduplication** on re-train: a header-pinned artifact
matches an existing one by `slug` only, while a name-derived slug matches either
`artifact_name` or `slug`. Pin the slug when a shell contract references the
artifact, so a renamed file updates that artifact instead of adding a second one.
A re-train that matches an existing artifact also needs `force_update: true`;
without it **`train`** fails with `Artifact "<name>" already exists on this
adapter`.

The response lists `squadrules://artifact/{slug}` items — the stored id only
when no slug was persisted; the same stable **slug** appears in **`activate`**'s
`linked_artifacts[]`. Response contains `status: stored` and `items` with `layer_uuid`, `adapter_uri`, `layer` URIs, labels, tags.

**Size limits (safety):** Before structure checks, the server rejects oversized Markdown and artifact bodies (max logical lines, max UTF-8 bytes per line, and a total-byte ceiling from env — default line cap **350**, default per-line bytes **8192**, safety factor **1.15**). See the Train workflow in the [project Wiki](https://github.com/jakub-plichcinski/squadrules-mcp/wiki).

**Output:** `status: stored` and `items` with `layer_uuid`, `adapter_uri`, `layer` URIs, labels, tags. Response envelope includes `ttlMs` and `cacheScope` cache metadata.

**After train:** Use **`activate`** / **`forward`** to execute; use **`tune`**
for in-place adapter/layer edits (non-structural); use **`train`** with
`force_update: true` for structural adapter replacement; use **`export`** to
dump markdown or datasets.

For contract shapes and examples, call **`forward`** with
`squadrules://adapter/author-adapter` and omit `solution` on the first call of
the run (then follow `next_action`).

**On failure:** If train fails with a duplicate adapter error, inspect the match and either use `force_update: true` to replace it or choose a different title. If structure validation fails, fix the markdown to include the required H1 title, Activation Patterns section, Reward Signal section, and at least one fenced JSON block with a contract object. If it fails with `VERSION_CONFLICT`, re-read the current adapter (**`export`**) and rebase your edit on that version; if it fails on inheritance (`single_parent` / `override_unknown_field` / `structural_override_forbidden`), fix the frontmatter — the message names the offending field and nothing was written.
