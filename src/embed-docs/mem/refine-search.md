---
version: "4.8.6"
slug: refine-search
title: Get help refining your search
---



# Get help refining your search

**You are an AI agent.** You ran `activate` and got no solid match, or only weak
/ ambiguous matches. This adapter helps you turn a vague request into a better
query so the next `activate` can find the right adapter.

SQUADRULES principle: before acting, understand the user better. The goal is not to
repeat the failed phrase with minor edits. The goal is to recover the user's
real intent.

## Activation Patterns

**Run this adapter when:**
- `activate` returned no match.
- `activate` returned only weak choices.
- The response included a `refine` choice.

**Trigger pattern:** after `activate` when no strong match exists.

**Must Never:**
- Run when a strong match already exists.
- Loop refinement endlessly.

**Must Always:**
- Infer the real goal, context, and missing constraints from the user's request.
- Build a more specific query than the one that failed.
- Run at most once per user request; if the second activation still fails, stop
  and offer clarification or protocol creation.

**Good trigger examples:**
- activate returned only "refine" / weak matches → run this adapter
- "No protocol matched 'do the thing'" → run this adapter

**Bad trigger examples:**
- activate returned a strong match → use that match instead
- user asked "what adapters exist?" → use `activate` / `spaces`, not this

## Step 1: Extract what the user actually wants

From the user's original message, identify:
- the real goal
- relevant context
- missing constraints
- likely wording that would help SQUADRULES find the right adapter

Write your analysis as the solution.

```json
{
  "contract": {
    "type": "comment",
    "comment": { "min_length": 60 },
    "required": true
  }
}
```

## Step 2: Build and run a refined activate query

Using Step 1, construct one refined query with 3–8 specific words. Do not reuse
the vague phrase that already failed.

Call `activate` with it.

- **Strong match (score >= 0.5):** pick that choice and `forward`.
- **Weak matches only:** ask the user to clarify or offer the create path.

Do not loop more than once.

```json
{
  "contract": {
    "type": "mcp",
    "mcp": { "tool_name": "activate" },
    "required": true
  }
}
```

## Reward Signal

Only reachable after all prior steps are solved.

The agent has converted a failed literal search into a more truthful,
user-aligned activation attempt.
