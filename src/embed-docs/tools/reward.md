Finalize an adapter run with an outcome and optional evaluator metadata.

**When:** After **`forward`** reports the last layer is done and `next_action` tells you to call **`reward`**.

**Input**

- `uri` — **`squadrules://layer/{uuid}`** (final layer; include `?execution_id=...` when the run used it).
- `outcome` — `success` or `failure`.
- Optional: `score` (0–1), `feedback`, `rater`, `rubric_version`, `llm_model_id`.
- Optional evolution keys (see **Evolution proposals** below): `proposal`, `proposal_decision`, `proposal_actor_kind`, `proposal_evidence`.

**Export eligibility:** To make reward rows exportable for SFT and preference training datasets, you **must** provide:

- `rubric_version` — a version tag (e.g. `"v1"`) identifying which rubric or policy was used to evaluate the run.
- `rater` or `llm_model_id` — at least one to establish evaluator identity.

Omitting either produces `sft_blockers: ["missing_rubric_version"]` / `preference_blockers: ["missing_rubric_version"]` (or `missing_evaluator_identity`) in the response, making the row non-exportable.

**Output:** Per-layer result rows with `rated_at`, normalized grading
metadata (`grader_kind`, `evaluation_label`), export eligibility
flags plus blocker lists for `sft_jsonl` and `preference_jsonl`, and
`next_call: null` as the explicit terminal marker. Response contains the evaluation result and export eligibility status. Response envelope includes `ttlMs` and `cacheScope` cache metadata.

**Evolution proposals.** A failed reward turns its anomaly into a **verifiable, scoped proposal** against the adapter it came from. Reward never edits that adapter: `evolution.apply_plan` carries `target_uri`, `target_key`, `expected_version`, `field`, `from_value`, `to_value`, and `instructions`, and you apply it with normal **`tune`**/**`train`** — the usual validators and compare-and-swap stay in force (`docs/adr/0046-evidence-gated-evolution-proposals.md`).

- To confirm or reject one: `proposal` (the `proposal:<32 hex>` key from a previous reward), `proposal_decision` (`confirm` | `reject`), `proposal_actor_kind` (`agent` | `human_expert` — the expert tier only counts when the server resolved an authenticated subject; a claim alone does not escalate), `proposal_evidence` (the empirical proof — test output, logs, examples).
- Quorum ladder, highest rung first: **evidence** (confirm or reject) → **authenticated human expert** → for a core contradiction, one confirming observation → **two thirds of the required distinct agents**, and only when **≥ 3 distinct children** reported the same anomaly. Confirmations are counted per child, not per call, so repeating the same agent is not a quorum.
- Below quorum the decision is `pending` (record more confirmations) or `branch` (participants disagree without deciding evidence — keep the parent unchanged and train a sub-category adapter instead). Only `accept` produces an apply plan.
- Evidence outranks authority and votes, and a recorded digest proves the bytes you submitted, not that the claim is true — a rejected or branched proposal leaves the parent untouched, with no partial write.

**Rules:** Use only layer URIs returned by **`forward`**. Do not substitute adapter URIs here unless the tool schema explicitly allows it (this tool expects a layer URI). Read `evolution.next_action` and follow it — it already states the next concrete step for `accept`, `reject`, `branch`, or `pending`.

**On failure:** If reward fails with a proof conflict, fix the failed step and run it again before retrying reward. Check that the layer URI and execution_id match the forward call.
