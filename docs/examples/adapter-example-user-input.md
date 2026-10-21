# Example: User input contract (emergency authority gap)

Short adapter example: one step that requires a human decision the agent **cannot** resolve autonomously. Ready to train with `train`.

The `user_input` contract is for **emergencies only** ([ADR 0009](../adr/0009-autonomous-adapter-execution-no-human-gates.md)):

- A genuine authority gap: the agent lacks permission to choose between options that have irreversible or high-cost consequences.
- A missing decision: the correct path depends on information or preference that exists only in the human's head and cannot be inferred from the codebase, configuration, or team knowledge.

This is **NOT** for:

- Routine confirmation ("Should I proceed?") — the agent owns execution; proceed.
- Approval gates ("Do you approve this PR?") — the agent has authority to open PRs.
- Clarification the agent can resolve by reading code, docs, or searching team knowledge.
- Any question whose answer could be found by the agent with existing tools and authorization.

A well-designed adapter minimizes or eliminates `user_input` contracts. If your adapter needs human confirmation at every step, the adapter is under-specified — give the agent enough context to decide autonomously.

## Activation Patterns

Run when user says "example user input" or "authority gap example".

## Step 1 — Resolve the ambiguous target

The agent has prepared a database migration but the target environment is genuinely ambiguous: two environments share the same slug prefix, and running against the wrong one is irreversible. The agent cannot determine the correct target from configuration, branch name, or team knowledge. This is a real authority gap.

```json
{
  "contract": {
    "type": "user_input",
    "user_input": {
      "prompt": "Migration 0042_add_audit_index targets 'prod-eu'. Both prod-eu-west and prod-eu-central match this prefix. The migration is irreversible (drops the old index). Which environment should receive it?"
    },
    "required": true
  }
}
```

The prompt states: what the agent has already determined, why it cannot decide alone, and what specific answer it needs. Vague prompts ("What should I do?") waste the human's time.

## Step 2 — Run complete

Only reachable after Step 1 is solved. Execute the migration against the confirmed target and show the result to the user. No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
