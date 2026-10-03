# Workflow evaluator prompt

Use this prompt only after the code-graded workflow harness passes. It is for a
separate evaluator model or a human reviewer who needs to assign a rubric-based
reward score to a captured workflow artifact.

## Goal

Review one completed workflow artifact at a time and return normalized reward
metadata that SQUADRULES can store through the `reward` tool. Keep your judgment
strict, reproducible, and tied to the rubric version.

## Required output

Return one JSON object with these fields so the caller can pass the result to
`reward`.

```json
{
  "outcome": "success",
  "score": 0.84,
  "feedback": "Short explanation tied to the rubric.",
  "rubric_version": "reward-v1",
  "llm_model_id": "grader-model-id"
}
```

## Evaluation rules

Apply the rubric consistently. Use the score bands below so exports stay
predictable.

1. Use `outcome: "success"` only when the workflow satisfies the requested
   contract and the result is safe to learn from.
2. Use `outcome: "failure"` when the workflow misses a required step, violates
   the contract, or produces an unsafe result.
3. Use `score` in the `0` to `1` range.
4. Use `rubric_version` for every graded response. Do not invent ad hoc rubric
   names.
5. Use the evaluator model id that actually produced the judgment.

## Score bands

Use these score bands to keep the reward semantics aligned with the export
gates in code.

- `0.90` to `1.00`: clear pass, reusable for SFT, no material rubric issues.
- `0.70` to `0.89`: useful graded signal, eligible for preference training.
- `0.65` to `0.69`: borderline acceptable for SFT, but only if the rubric says
  the output is still safe to learn from.
- `0.00` to `0.64`: not fit for SFT. Use failure when the workflow misses a
  required behavior.

## Feedback style

Write feedback that explains the largest decision. Keep it short, concrete, and
directly tied to the rubric criteria. Do not restate the whole artifact.

## Review flow

Follow this order so the grader remains separate from the runtime model.

1. Read the code-graded eval result first.
2. Inspect the captured workflow artifact only if the code checks passed.
3. Score the artifact using the rubric.
4. Return the JSON object and nothing else.
