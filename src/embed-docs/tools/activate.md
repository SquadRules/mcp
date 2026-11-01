Rank stored **adapters** for the user’s intent and return the literal next
`forward` call arguments.

**When to call:** Whenever the message describes an action, task, or workflow —
even if the user never says "SQUADRULES". Always pass a short `query` summary.

Happy-path flow:

1. Call `activate` with a short `query`.
2. Pick one `choices[]` row.
3. Copy `choices[].forward_first_call` directly into `forward`.

Example:

```json
{
  "query": "review implementation plan"
}
```

Response row (match/refine):

```json
{
  "role": "match",
  "uri": "squadrules://adapter/critic-loop",
  "forward_first_call": {
    "uri": "squadrules://adapter/critic-loop"
  }
}
```

Next call:

```json
{ "uri": "squadrules://adapter/critic-loop" }
```

**Input**

- `query` — required short intent summary (about 3-8 words).
- `execution_id` (optional) — server-issued id for a refinement sequence. Omit on the first activate call; echo it back when you re-run activate with a refined query for the same user request.
- `space` / `space_id` (optional) — narrow search to one space: `"personal"`, a
  full group path such as `"/shared/pe-team"` (optional `"Group: "`
  prefix), or your raw `space_id` (same forms as **`train`** / **`tune`** `space`).
- `max_choices` (optional) — cap on match rows returned.

**Output:** Always `must_obey: true`. Includes `choices` (each with slug-form
`uri`, `label`, `adapter_name`, `activation_score`, `role`, `tags`,
`next_action`, optional `adapter_version`, optional `activation_patterns`,
optional `linked_artifacts`, `space_name`, `slug`, and `forward_first_call`) plus `execution_id` (echo it back when refining).

`forward_first_call` is required on `match` and `refine`, and `null` on
`create`.

**`linked_artifacts[]`** — a `match` choice whose adapter ships scripts carries one
row per artifact: `slug`, `filename`, `relative_path`, `content_type`, `sha256`,
`download_url`, and `materialize`. The `materialize` field carries the exact
`cmd` that puts the file on disk: it creates the parent directory, writes the
bytes, verifies the `sha256` digest, and sets `chmod 700`. **Run that line
verbatim — do not retype artifact bytes into an editor, a heredoc, or an inline
script; byte-exactness is the framework's job, not yours.** The byte source
depends on the transport:

- **HTTP:** `cmd` downloads `download_url` with `curl -fsS`, zero-copy. The
  paired `arguments` (`uri: "squadrules://artifact/{slug}"`, `format: "source"`)
  are for *reading* the artifact instead.
- **stdio/local:** there is no listener to download from, so call the MCP
  `export` tool with the row's `arguments` — it returns the bytes as
  `content` with `content_encoding: "base64"` — set `B64` to that `content`, then
  run `cmd`. `cmd` stops with a stated reason when `B64` is unset.

Follow the instruction **before** the first `shell` contract that invokes an
artifact path. `relative_path` is exactly the path the adapter's
contract expects, so materialize from the `activate` choice you picked —
`forward` does not repeat this list.

When a choice carries no artifact rows but its contract names a script path, the
artifact is missing or was not loaded: call **`export`** for that adapter
(`format: skill_tree` for the file list, `format: skill_zip` for the bundle) and
check `artifacts/` for the path the contract invokes. **`export` is the tool that
returns adapter files** — `activate` returns artifact rows, `forward` returns
instructions.

**`squadrules_local_artifact_dir`** — ordered URI hints (preferred first) for the run's local handoff dir (drafts, review outputs, generated files, checksums shared between layers and subagents). Two schemes, both resolved **on your machine**: `project://<rel>` → `<your project root>/<rel>`; `user://<rel>` → `<your home or $XDG_CONFIG_HOME>/<rel>`. Pick `project://` when you have exactly one project context; fall through to `user://` when your session spans multiple projects so artifacts from different projects don't collide. After resolving, `export SQUADRULES_LOCAL_ARTIFACT_DIR="<absolute>"` for shell challenges (skip if your shell already defines it). The server never resolves these to a path on its own filesystem; the value carries no server paths and is identical for stdio and HTTP transports. Not a shell cwd, not a Docker `WORKDIR`.

When several spaces contain similar adapters, the server prefers your **default write space** (usually **Personal**) on ties so a personal copy can override a group template.

**Roles**

- `match` — `activation_score` is a normalized 0.0–1.0 confidence score; copy
  `forward_first_call` into `forward`.
- `refine` — guided help to improve the query; copy `forward_first_call` into
  `forward`.
- `create` — no stored adapter matched; **`train`** new adapter markdown (adapter/workflow creation flow).

**Rules**

- Pick **one** choice and obey **that** choice’s `next_action` (not a different URI).
- Weak matches (e.g. all scores &lt; 0.5): prefer the refine choice once before creating.
- If you re-run `activate` more than twice with the same `execution_id`, the default refine footer is removed so you stop looping and instead create a custom adapter/workflow or ask the user clarifying questions.


## Adapter authoring requests

When the user asks to create, review, or update an adapter itself, supply
`authoring` with the operation inferred from their request. For review/update,
resolve the existing target URI first; do not guess a slug from a display name.
Do not supply this field when the user wants to execute an adapter.

```json
{
  "query": "update existing PR adapter worktree isolation",
  "authoring": {
    "operation": "update",
    "target_adapter_uri": "squadrules://adapter/sample-pr-workflow"
  }
}
```

Explicit authoring intent returns the `author-adapter` workflow as a match with
operation and target in `forward_first_call`. Copy that entire object to forward.
This is deterministic routing of a known operation; ordinary queries continue to
use semantic discovery. Missing targets or unavailable authoring workflows fail
without falling back to creation. This context is not a grant of permission.
