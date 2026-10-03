// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
Register a new **adapter** from markdown (one H1 = one adapter; each verifiable segment ends with a fenced `json` block containing a top-level **`contract`** object).

**Input**

- `content` — full document string (optional if `source_adapter_uri` supplies content).
- `llm_model_id` — required model identifier string.
- `force_update` (optional) — replace an existing adapter with the same label.
- `protocol_version` (optional) — version string (e.g. semver) stored on the adapter.
- `space` (optional) — `"personal"` or a full group path such as `"{{KAIROS_GROUP_SPACE_PATH_EXAMPLE}}"` (target space for the new adapter).
- `source_adapter_uri` (optional) — `kairos://adapter/{uuid}` to **fork**: export that adapter’s markdown and **train** a **new** adapter (new ids). If you also pass `content`, that text is used instead of the export (customize before calling **`train`**).
- `mime` (optional) — content MIME type. Defaults to `text/markdown`.
- `artifact_name` (required when `mime` is not `text/markdown`) — file name shown when listing adapter artifacts.
- `adapter_uri` (required when `mime` is not `text/markdown`) — `kairos://adapter/{uuid}` or `kairos://adapter/{slug}` target adapter for the artifact attachment.
- `relative_path` (optional, non-markdown artifacts only) — path relative to the skill bundle root (forward slashes; no `..` segments). When set, **`export`** **`skill_zip`** and **`skill_tree`** place the file at this path instead of the default **`artifacts/<sanitized artifact name>`** layout.
- `review_evidence` (required for adapter/markdown trains) — phase-critic verdict proof. Run phase-critic before **`train`**; provide the verdict file as proof. Object with `verdict_file` (absolute path), `exit_code` (must be 0), and `stdout` (line 1 must be PASS). Not required for artifact trains (non-markdown mime).

**Required structure (validated before store)**

- H1 title for the adapter.
- First H2: **Activation Patterns**.
- Last H2: **Reward Signal**.
- At least one fenced **` ```json `** block whose JSON has a top-level
  **`contract`** object.
- Contract fences must use the `json` language tag only (no plain ``` blocks holding contract JSON).
- Non-markdown artifacts (`mime` not `text/markdown`) are stored as adapter-linked artifacts instead of stored Markdown layers.

**Size limits (safety):** Before structure checks, the server rejects oversized Markdown and artifact bodies (max logical lines, max UTF-8 bytes per line, and a total-byte ceiling from env — default line cap **350**, default per-line bytes **8192**, safety factor **1.15**). See the Train workflow in the [project Wiki](https://github.com/jakub-plichcinski/kairos-mcp/wiki).

**Output:** `status: stored` and `items` with `layer_uuid`, `adapter_uri`, `layer` URIs, labels, tags.

**After train:** Use **`activate`** / **`forward`** to execute; use **`tune`**
for in-place adapter/layer edits (non-structural); use **`train`** with
`force_update: true` for structural adapter replacement; use **`export`** to
dump markdown or datasets.

For contract shapes and examples, call **`forward`** with
`kairos://adapter/create-new-protocol` and omit `solution` on the first call of
the run (then follow `next_action`).
