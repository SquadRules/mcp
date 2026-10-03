Finalize an adapter run with an outcome and optional evaluator metadata.

**When:** After **`forward`** reports the last layer is done and `next_action` tells you to call **`reward`**.

**Input**

- `uri` — **`squadrules://layer/{uuid}`** (final layer; include `?execution_id=...` when the run used it).
- `outcome` — `success` or `failure`.
- Optional: `score` (0–1), `feedback`, `rater`, `rubric_version`, `llm_model_id`.

**Export eligibility:** To make reward rows exportable for SFT and preference training datasets, you **must** provide:

- `rubric_version` — a version tag (e.g. `"v1"`) identifying which rubric or policy was used to evaluate the run.
- `rater` or `llm_model_id` — at least one to establish evaluator identity.

Omitting either produces `sft_blockers: ["missing_rubric_version"]` / `preference_blockers: ["missing_rubric_version"]` (or `missing_evaluator_identity`) in the response, making the row non-exportable.

**Output:** Per-layer result rows with `rated_at`, normalized grading
metadata (`grader_kind`, `evaluation_label`), export eligibility
flags plus blocker lists for `sft_jsonl` and `preference_jsonl`, and
`next_call: null` as the explicit terminal marker.

**Rules:** Use only layer URIs returned by **`forward`**. Do not substitute adapter URIs here unless the tool schema explicitly allows it (this tool expects a layer URI).
