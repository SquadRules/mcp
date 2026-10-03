Update existing **adapter** content in place.

**Input**

- `uris` — non-empty list of `squadrules://adapter/{uuid}` and/or `squadrules://layer/{uuid}` targets.
- `content` (optional) — parallel array of full markdown bodies (preferred for text changes).
- `updates` (optional) — advanced field map; prefer `content` for ordinary edits.
- `space` (optional) — `"personal"` or a full group path such as `"{{SQUADRULES_GROUP_SPACE_PATH_EXAMPLE}}"`: reassign **all layers** of each targeted adapter to that space. You can use **`space` alone** (move only) or combine with `content` / `updates` (edit then move). Adapter URI moves every layer; layer URI moves that layer only.
- `review_evidence` (required when `content` is provided) — phase-critic verdict proof. Run phase-critic before **`tune`** with content; provide the verdict file as proof. Object with `verdict_file` (absolute path), `exit_code` (must be 0), and `stdout` (line 1 must be PASS). One PASS covers all URIs in the tune call. Not required for space-only moves or updates-only (no content) tunes.

**Output:** `results` with per-URI `status` (`updated` | `error`) and `message`, plus totals.

**Rules:**

- Pass layer URIs when you want to edit specific layers.
- Pass adapter URIs when you want in-place edits across that adapter's stored
  layers without replacing adapter identity.
- Use **`train`** with `force_update: true` for structural replacements (for
  example, changing adapter identity/H1 mapping or layer count).
- When you pass layer URIs, the server normalizes to the underlying stored
  memories.
- Refresh execution context after large **`tune`** edits (new **`forward`**
  from the adapter URI).
