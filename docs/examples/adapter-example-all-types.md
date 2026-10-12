# Example: All challenge types

One adapter with four steps, one per challenge type (shell, mcp, user_input, comment). Ready to train with `train`.

## Activation Patterns

Run when user says "example all types" or "all challenge types".

## Step 1 — Run a command

Run the given shell command. Exit code 0 means success.

```json
{
  "contract": {
    "type": "shell",
    "shell": {
      "cmd": "echo OK",
      "timeout_seconds": 10
    },
    "required": true
  }
}
```

## Step 2 — Call an MCP tool

Call the `activate` tool with any query and report success.

```json
{
  "contract": {
    "type": "mcp",
    "mcp": {
      "tool_name": "activate"
    },
    "required": true
  }
}
```

## Step 3 — Get user confirmation

Obtain explicit approval from the user before continuing.

```json
{
  "contract": {
    "type": "user_input",
    "user_input": {
      "prompt": "Proceed to the next step?"
    },
    "required": true
  }
}
```

## Step 4 — Provide a verification comment

Write a short summary of what was done in this adapter (at least 30 characters).

```json
{
  "contract": {
    "type": "comment",
    "comment": {
      "min_length": 30
    },
    "required": true
  }
}
```

## Step 5 — Run complete

Only reachable after Steps 1–4 are solved. Show the outputs from Steps 1–4 to the user (command result, MCP result, user confirmation, summary). No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
