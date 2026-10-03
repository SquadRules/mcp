// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
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
  "uri": "kairos://adapter/phase-critic",
  "forward_first_call": {
    "uri": "kairos://adapter/phase-critic"
  }
}
```

Next call:

```json
{ "uri": "kairos://adapter/phase-critic" }
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
`space_name`, `slug`, and `forward_first_call`) plus `execution_id` (echo it back when refining).

`forward_first_call` is required on `match` and `refine`, and `null` on
`create`.

**`kairos_local_artifact_dir`** — ordered URI hints (preferred first) for the run's local handoff dir (drafts, review outputs, generated files, checksums shared between layers and subagents). Two schemes, both resolved **on your machine**: `project://<rel>` → `<your project root>/<rel>`; `user://<rel>` → `<your home or $XDG_CONFIG_HOME>/<rel>`. Pick `project://` when you have exactly one project context; fall through to `user://` when your session spans multiple projects so artifacts from different projects don't collide. After resolving, `export KAIROS_LOCAL_ARTIFACT_DIR="<absolute>"` for shell challenges (skip if your shell already defines it). The server never resolves these to a path on its own filesystem; the value carries no server paths and is identical for stdio and HTTP transports. Not a shell cwd, not a Docker `WORKDIR`.

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
