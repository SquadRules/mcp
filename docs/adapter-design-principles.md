# Adapter Design Principles: Autonomy and Verification

Adapters help agents complete work using the team’s preferences. They should reduce uncertainty and coordination, including coordination between the agent and SquadRules.

**Every check must justify its interruption. Verify meaningful outcomes with the fewest necessary round trips.**

## Start with the outcome

Define what the agent must accomplish, what authority it already has, and what evidence demonstrates completion.

Write clear instructions for intermediate work. An instruction does not automatically need its own contract.

## Let the agent own execution

Agents find, execute, create, repair, and maintain workflows. When preferences change or execution exposes a gap, updating the adapter is part of completing the task.

Use known preferences and existing authorization. Ask the human only when a necessary decision or permission is genuinely missing. Never invent either to avoid asking.

A routine failure should produce a recovery action, not an automatic handoff to the human.

## Put checks where they change the next action

Add a checkpoint when its result determines whether the agent should proceed, repair, stop, or ask for help.

Useful boundaries include:

- Before an action whose consequences make recovery difficult.
- Before consuming an input that may be missing or unusable.
- At completion, to verify the requested outcome.

Do not add a checkpoint merely because a phase has a name.

## Combine checks that belong together

When several conditions support the same decision, validate them together and return all actionable failures.

For example, check a draft’s required sections and internal consistency before publication. Avoid separate exchanges confirming that requirements were written, a draft was created, and the agent is ready to review it.

Keep checks separate when an earlier result changes later work, or when combining them would allow a consequential action before verification.

## State what the evidence proves

| Evidence             | What it establishes                     | What it does not establish         |
| -------------------- | --------------------------------------- | ---------------------------------- |
| A nonempty file      | Some content exists                     | The content is correct or complete |
| A successful command | The command’s success condition was met | The entire task succeeded          |
| A tool response      | The tool reported a result              | Every intended effect occurred     |
| A review verdict     | The reviewer reached a conclusion       | The review was thorough or correct |
| An acknowledgment    | The agent submitted a statement         | Understanding or execution         |

Choose evidence that matches the claim. Where needed, inspect the resulting state.

Submitted execution evidence is not automatically independent verification. A nonce or hash can associate a submission with a step without proving that the underlying work occurred.

## Use judgment where observation is insufficient

Use direct checks for observable facts. Use review for questions such as whether an adapter captures the user’s intent, respects authorization, or gives clear instructions.

Give the reviewer explicit criteria and access to the actual work. Require findings supported by evidence.

Do not add review after every phase by default. Place it where it can detect consequential errors before they propagate.

## Avoid acknowledgment loops

Do not require “I understand,” “I am ready,” or a minimum-length summary as proof of quality.

Knowledge guides should provide usable instructions without unnecessary confirmation exchanges. If the framework requires an acknowledgment to close a run, keep it minimal and describe it as a protocol requirement—not verification of understanding.

## Make failure useful

A failed check should identify:

- What failed.
- What evidence supports that finding.
- What to do next.
- Whether retrying is appropriate.

Preserve valid work. Bound retries. If the check itself is unsuitable, repair it within the agent’s authority or obtain a necessary policy decision. Never report a failed check as passed.

## Design for less capable models

Use explicit conditions, concrete next actions, consistent terms, and clear completion criteria.

Keep necessary guidance. Remove repeated confirmations. Put bookkeeping and mechanical validation in the framework wherever possible.

## Review every proposed contract

Before adding a contract, answer:

1. Which failure does it detect?
2. What does its evidence actually prove?
3. How does its result change execution?
4. Can an existing check cover it?
5. Is the interruption worth the protection?

If those answers are unclear, improve the instruction or remove the checkpoint.

## Supporting rationale

For each retained contract, record its purpose, evidence, limitations, and failure response. Explain why it must be separate when another check appears similar.

These examples support the principles. They must not become a justification for preserving unnecessary checks.
