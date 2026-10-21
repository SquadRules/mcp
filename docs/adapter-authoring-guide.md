# Adapter Authoring Guide: Flow and Verification

Status: working draft. This guide applies the
[design principles](adapter-design-principles.md) to adapter flow and contract
selection. It describes the target behavior; implementation alignment is pending.

## Define the flow first

State the trigger, required inputs, existing authority, intended outcome, and
completion evidence. Group reversible work into meaningful stages. Give each
stage explicit instructions and a failure response. Add a contract only when its
result changes whether execution proceeds, repairs, stops, or asks for help.

A stage is not automatically a separate layer or MCP exchange. Keep dependent
instructions together when no intermediate result needs a separate decision.

## Choose a check by its purpose

| Need | Contract or mechanism | Required evidence and limits |
| --- | --- | --- |
| Observe an artifact or state | `shell` | Actual command result and relevant observations. Check content or state, not just file existence. |
| Delegate work or assess meaning | `subagent` | Explicit inputs, criteria, result, and supporting evidence. Define how the caller handles failure. |
| Perform an MCP operation | Actual MCP call through the supported contract mechanism | Record the actual response and inspect resulting state where necessary. A delegated call must return its result, not an acknowledgment. |
| Produce a statement as the deliverable | `comment` | The requested content. Length does not establish understanding or execution. |
| Resolve missing authority or preference | `user_input` | The human's actual answer. Reuse existing authorization rather than requesting it again. |

Use the connected server's schema for real calls. Verify the target release's
supported contract types before writing executable examples. These choices are
purpose-based, not a universal ranking: shell checks cannot establish every
semantic claim, and delegation is not automatically independent verification.

## Keep verification compact

Combine checks supporting the same decision. Return all actionable failures in
one result. Reuse evidence while its inputs remain unchanged; repeat a check
when relevant state changes or evidence becomes stale.

Keep a separate boundary when its result changes subsequent work or when a
consequential action must not happen before verification. Place prerequisites
with the work that consumes them unless an earlier check prevents substantial
wasted work. Do not add acknowledgment layers between ordinary stages.

## Example: author and publish an adapter

1. **Prepare:** resolve the requested operation, gather known preferences, and
   draft the adapter. Keep these reversible instructions together. Ask only for
   a genuinely missing decision.
2. **Review readiness:** combine mechanical draft checks in one `shell` result.
   Use `subagent` review for intent, authorization, and clarity when those claims
   need judgment. Supply the actual draft and acceptance criteria.
3. **Repair:** address specific findings, then recheck affected claims. Bound the
   review loop. A changed draft invalidates review evidence about changed parts.
4. **Publish:** after readiness passes and authority is established, perform the
   actual `train` or `tune` operation using the supported mechanism.
5. **Verify completion:** use the returned identifier to inspect the stored
   result and compare it with the intended adapter. Report the verified outcome.

Do not insert separate contracts for “requirements written,” “draft exists,” or
“I understood the review.” Keep readiness before publication and outcome
verification after it: they answer different questions.

## Failure and completion

For every contract, name the failure it detects, what evidence proves, the next
action on failure, and the retry limit. Distinguish a failed result from a check
that could not run. Preserve valid work and never turn either into a false pass.

Knowledge guides need no understanding test. If the framework requires a closing
acknowledgment, keep it minimal and label it as protocol completion only.

## Implementation work tracked by this draft

- [ ] Finalize the flow and contract-selection guidance with concrete examples.
- [ ] Audit bundled adapters: retain each check only with a clear decision purpose.
- [ ] Combine redundant checks and remove acknowledgment loops where supported.
- [ ] Align authoring, review, challenge-type, and linking guides with these rules.
- [ ] Align skill and prompt guidance without duplicating their shared core.
- [ ] Identify runtime gaps separately from adapter-content changes.
- [ ] Test required boundaries, honest failures, bounded recovery, and completion.
- [ ] Measure round trips on representative flows before and after changes.

This checklist is pending work, not a claim of implemented behavior. Record
significant architecture choices in ADRs; keep authoring rules in these guides.
