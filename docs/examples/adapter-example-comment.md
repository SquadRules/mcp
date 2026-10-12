# Example: Comment challenge

Short adapter example: one real step plus a final verification step. Requires a verification comment or summary of at least 50 characters. Ready to train with `train`.

## Activation Patterns

Run when user says "example comment" or "comment challenge".

## Step 1 — Summarize changes

Provide a short summary of the changes made. Minimum 50 characters.

```json
{
  "contract": {
    "type": "comment",
    "comment": {
      "min_length": 50
    },
    "required": true
  }
}
```

## Step 2 — Run complete

Only reachable after Step 1 is solved. Show the output from Step 1 to the user (the summary text that was submitted). No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
