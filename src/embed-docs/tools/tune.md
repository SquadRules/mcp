Update existing **adapter** content in place.

**Input**

- `uris` — non-empty list of `squadrules://adapter/{uuid}` and/or `squadrules://layer/{uuid}` targets.
- `content` (optional) — parallel array of full markdown bodies (preferred for text changes).
- `updates` (optional) — advanced field map; prefer `content` for ordinary edits.
- `space` (optional) — `"personal"` or a full group path such as `"{{SQUADRULES_GROUP_SPACE_PATH_EXAMPLE}}"`: reassign **all layers** of each targeted adapter to that space. You can use **`space` alone** (move only) or combine with `content` / `updates` (edit then move). Adapter URI moves every layer; layer URI moves that layer only.
- `expected_version` (optional) — compare-and-swap guard: the adapter version this write was prepared against. It is checked against the adapter head **before anything is written**, for an adapter URI and for a layer URI that is a stored layer of an adapter. A stale value fails that URI with `VERSION_CONFLICT`; a layer that cannot be tied to a stored adapter head fails with `VERSION_GUARD_UNSUPPORTED` instead of writing unguarded. Use it when restoring a historical snapshot or applying an accepted evolution proposal.
- `review_evidence` (required when `content` is provided) — critic-loop verdict proof. Delegate a subagent to run critic-loop before **`tune`** with content; do not review your own edit on the caller's thread. Provide the verdict file as proof. Object with `verdict_file` (absolute path), `exit_code` (must be 0), and `stdout` (line 1 must be PASS). One PASS covers all URIs in the tune call. Not required for space-only moves or updates-only (no content) tunes.

**Output:** `results` with per-URI `status` (`updated` | `error`) and `message`, plus totals. A failed row **may** carry a typed `error`: version-guard failures use `code`/`target`/`expected` (`current` on a `VERSION_CONFLICT`, `reason` on an unsupported guard) and unavailable inheritance validation uses `code`/`status`/`details`; every other failure is message-only, so branch on the code only when `error` is present, never on the sentence. Response contains the update results and any errors encountered. Response envelope includes `ttlMs` and `cacheScope` cache metadata.

**History:** when the tuned adapter head projects successfully into the graph, the tune appends an immutable snapshot (content, digest, actor, space, parent version, reason) and the previous document is not overwritten in place. The projection is best-effort — a successful text update alone does not prove a snapshot was written — so recovery via **`export`** (`version: "<n>"`) plus a normal **`train`**/**`tune`** carrying `expected_version` depends on the snapshot actually being present. Read history through **`export`**, not through a graph query (`docs/adr/0045-graph-native-history-and-restore.md`).

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

**On failure:** If tune returns an error status, verify the URI exists and check the message for details. If the error is "layer not found", verify the URI or train a new adapter if needed. If the row carries `error.code: VERSION_CONFLICT`, re-read the current adapter (**`export`**) and rebase the edit on `error.current`. If it carries `error.code: VERSION_GUARD_UNSUPPORTED`, the URI names no adapter head to compare — retry with the adapter URI. Restoring a snapshot or applying an accepted evolution proposal must stay guarded on a resolvable head and its observed version (`docs/adapter-authoring-guide.md`); omitting `expected_version` to write unguarded applies only to ordinary edits, never to those guarded operations. If review_evidence validation fails, ensure the critic-loop verdict file is provided with exit_code 0 and PASS on stdout line 1.
