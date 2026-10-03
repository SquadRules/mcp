// squadrules-compat-surface: honors the kairos-doc-keep doc marker present in existing colocated README files
# Workflow eval harness

This directory defines the repeatable workflow eval harness for SQUADRULES.
Use it to verify code-graded behavior for `activate`, `forward`, `reward`,
`train`, `tune`, and `export` before you change reward semantics, retrieval,
or training exports.

<!-- kairos-doc-keep: directory-local test-harness operating instructions; the wiki "Testing" topic is generated overview, this is the runnable harness contract -->

## What lives here

This directory now focuses on deterministic evaluation assets instead of
open-ended agent sessions.

- `eval-harness.ts` provides shared helpers for structured eval cases.
- `README.md` explains how to run the harness and how to extend it.
- `PROMPT.md` defines the optional rubric-driven follow-up prompt for a
  separate evaluator model after code-graded checks pass.

## Current coverage

The first code-graded suite focuses on reward normalization and export
readiness because those behaviors gate every downstream training format.

- `tests/integration/reward-export-evals.test.ts` verifies that ungraded
  rewards stay out of SFT exports.
- `tests/integration/reward-export-evals.test.ts` verifies that rubric-scored
  model rewards can feed both SFT and preference exports.
- `tests/integration/reward-evals.test.ts` covers normalization logic and
  eligibility fallbacks at the unit level.

## How to run the harness

Run the eval harness against the dev server so the tests exercise the same MCP
surface that clients use.

1. Deploy the dev environment.

   ```bash
   npm run dev:deploy
   ```

2. Run the reward and export eval suites.

   ```bash
   NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand \
     tests/integration/reward-evals.test.ts \
     tests/integration/reward-export-evals.test.ts
   ```

3. Review any failed checks in the Jest output. The harness reports the case
   id, the failed check name, and the captured artifacts.

4. Re-run the broader workflow suites after the focused harness passes.

### Optional: agent-driven scenario test

If you validate via an IDE chat session, paste [PROMPT.md](PROMPT.md) (or inject
equivalent constraints), then have the agent run the four scenarios (imports;
activate + run; update layer; update adapter) using only SQUADRULES MCP tools and
writing output to `reports/<run-id>/`. Inspect `report.md` and `calls/*.json`
under that directory.

## Optional rubric-driven review

Use [PROMPT.md](PROMPT.md) only after the automated harness passes. That prompt
is for a separate evaluator model or a human reviewer when a workflow needs a
rubric-based score that code checks can't determine on their own.

## Next steps

Expand this harness as later roadmap items land. Add code-graded cases for
activation ranking, `tune`, and full migration cutover before you rely on
manual review.
