---
version: "5.10.0"
slug: challenge-type-guide
title: Challenge Type Selection Guide
---



# Challenge Type Selection Guide

Decision rules, JSON formats, interpreter selection, and anti-patterns for
choosing SQUADRULES challenge types. Loaded by protocol-authoring agents during
drafting and review.

## Activation Patterns

**Typically invoked by:** `author-adapter` and
`critic-loop`.

**Can be invoked directly when agent needs:**
- "challenge type reference" / "which challenge type to use"
- "how to write shell challenges" / "challenge format"
- "interpreter selection for challenges"

**Trigger pattern:** **challenge** + (type | format | selection | guide).

**Must Never:**
- Be used as an execution protocol.
- Select `comment` merely because it is easy.

**Must Always:**
- Be consulted before assigning challenge types to protocol steps.
- Choose the strongest observable contract available.
- Match challenge choice to the mode of the step: ask, decide, act, verify, or review.

**Good trigger examples:**
- drafting a new protocol and need challenge types → load this
- reviewing challenge type selection in a draft → load this

**Bad trigger examples:**
- "Create a new protocol" → use `author-adapter`
- "Review my protocol draft" → use `critic-loop`

## Core Rules

`comment` is the challenge type of **last resort**. If a step produces any
observable artifact — a file, a git state change, an API response, or an exit
code — use `shell` or `mcp` instead.

**Mode before challenge type:**
- **clarify / approve** → `user_input`
- **call a SQUADRULES / MCP tool** → `mcp`
- **execute or verify local state** → `shell`
- **pure reasoning with no observable artifact** → `comment`

### Decision Tree

```
Does the step call an MCP tool?
 ├─ YES → Is the step a chain link to another adapter?
 │         ├─ YES → "mcp" with tool_name + arguments (forward + slug URI)
 │         └─ NO  → "mcp" with tool_name only
 └─ NO → Does the step produce or verify a file, command result, or system state?
          ├─ YES → "shell"
          └─ NO → Does the step require human approval or choice?
                   ├─ YES → "user_input"
                   └─ NO → "comment" only if there is no stronger observable contract
```

### Challenge JSON Formats

**shell**
```json
{"contract":{"type":"shell","shell":{"cmd":"<command>","timeout_seconds":30},"required":true}}
```

**mcp**
```json
{"contract":{"type":"mcp","mcp":{"tool_name":"<tool>"},"required":true}}
```

**mcp with arguments (chain link)**
```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/<slug>"}},"required":true}}
```

Use the `arguments` form when the step's purpose is to invoke a specific
adapter via `forward`. The server validates that `solution.mcp.arguments`
is a superset of the contract's `mcp.arguments` (subset/deep matching),
proving the agent called the correct target — not just any `forward` call.

**user_input**
```json
{"contract":{"type":"user_input","user_input":{"prompt":"<specific question>"},"required":true}}
```

**comment**
```json
{"contract":{"type":"comment","comment":{"min_length":50},"required":true}}
```

### Solution JSON Formats

Every solution, regardless of type, follows the same envelope:

```json
{
  "type": "<challenge_type>",
  "outcome": "success | failure | skipped",
  "evidence": { /* type-specific proof data */ },
  "nonce": "<echo from contract>",
  "proof_hash": "<echo from contract>"
}
```

**shell solution**
```json
{
  "type": "shell",
  "outcome": "success",
  "evidence": {
    "exit_code": 0,
    "stdout": "...",
    "stderr": "",
    "duration_seconds": 1.2
  }
}
```

**mcp solution**
```json
{
  "type": "mcp",
  "outcome": "success",
  "evidence": {
    "tool_name": "activate",
    "arguments": { "query": "example search" },
    "response": { "choices": [...] }
  }
}
```

**user_input solution**
```json
{
  "type": "user_input",
  "outcome": "success",
  "evidence": {
    "confirmation": "agreed. proceed",
    "timestamp": "2026-05-18T14:49:00Z"
  }
}
```

**comment solution**
```json
{
  "type": "comment",
  "outcome": "success",
  "evidence": {
    "text": "Verified all 78 issues now have repo: labels."
  }
}
```

### Compatibility

The server also accepts older solution shapes where data is placed directly
under the type key (e.g. `{ "type": "shell", "shell": { "exit_code": 0 } }`)
instead of inside an `evidence` envelope. Always use the unified envelope with
`outcome` and `evidence` for new protocols.

## Interpreter Selection

| Task | Use bash | Use perl | Use python3 |
|---|---|---|---|
| File exists, tool installed, git state | yes | no | no |
| Simple content grep | yes | no | no |
| Multi-line regex | no | yes | no |
| Paragraph processing | no | yes | no |
| JSON validation | maybe | yes | yes |
| YAML / complex data structure checks | no | no | yes |

**Rule of thumb:** if bash requires `while read`, `grep | awk`, or heavy quote
escaping, rewrite in Perl. If you need imports for data formats, use Python.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Security and Working Directory Rules

Use `$SQUADRULES_LOCAL_ARTIFACT_DIR` as the base directory for local handoff
artifacts. File paths within it are provided as variables by the invoking agent
to avoid collisions between parallel sessions.

**Rules:**
- all file paths in shell challenges reference variables (e.g., `$DRAFT_FILE`,
  `$VERDICT_FILE`) set by the parent agent — never hardcode filenames
- the parent agent constructs collision-free paths under
  `$SQUADRULES_LOCAL_ARTIFACT_DIR` (e.g., with a session ID or random suffix)
- when using SQUADRULES MCP, the latest `activate` / `forward` / `next` response field `squadrules_local_artifact_dir` is an ordered array of URI hints (`project://<rel>`, `user://<rel>`); pick one (`project://` when you have exactly one project context, otherwise `user://`), resolve on your machine, and `export SQUADRULES_LOCAL_ARTIFACT_DIR="<absolute>"` if your shell does not already define it
- if the server-returned path is not usable on your local filesystem, resolve
  locally to `$PROJECT_DIR/.local/squadrules/work` and keep it stable for the run
- prerequisites create the directory
- Reward Signal cleans it up
- never write credentials or secrets to files

### Resolving `project://` and `user://` URI hints

The server returns relative URI hints — it never names an absolute path on its
own filesystem. Resolve on your machine:

| Scheme | Resolution | Example |
|--------|-----------|--------|
| `project://<rel>` | `<IDE project root>/<rel>` | `project://.local/squadrules/work` → `/home/user/repos/my-project/.local/squadrules/work` |
| `user://<rel>` | `<$XDG_CONFIG_HOME or $HOME>/<rel>` | `user://.config/squadrules/work` → `/home/user/.config/squadrules/work` |

When your session spans multiple projects, prefer `user://` to avoid ambiguity
about which project root applies. When you have exactly one project context,
`project://` is fine.

### Worktree placement (for task-isolation adapters)

When an adapter requires a git worktree for isolation, the worktree path MUST
be **outside** every existing checkout. A common mistake is placing the worktree
inside `$REPO_ROOT` (e.g. `$REPO_ROOT/.mcp.worktrees/...`), which the setup
script correctly rejects.

**Correct placement — absolute path examples:**

```
REPO_ROOT=/home/user/repos/my-project
# RIGHT: sibling of the repo, not inside it
WT=/home/user/repos/mcp.worktrees/<task-id>

# WRONG: inside the checkout (rejected by setup script)
# WT=/home/user/repos/my-project/.mcp.worktrees/<task-id>
```

**Common mistakes:**
- `$REPO_ROOT/.mcp.worktrees/...` — inside checkout, rejected
- `./mcp.worktrees/...` — relative path resolves inside checkout
- `$REPO_ROOT/../mcp.worktrees/...` — correct only if `..` actually exits the repo

**Rule of thumb:** `$(dirname "$REPO_ROOT")/mcp.worktrees/<task-id>`

### IDE worktree access limitations

Most IDE file tools (Write, Read, Edit) scope operations to the open project
root. They **cannot** reach worktrees placed outside `$REPO_ROOT`. When working
in an IDE:

1. Use the **terminal/shell tool** (not IDE file tools) to read/write files in
   external worktrees.
2. Shell commands: `cat`, `tee`, `cp`, or your editor's CLI mode work on any
   absolute path.
3. If you need to edit a worktree file with IDE assistance, open the worktree
   as a separate project window or use `code <worktree-path>` to add it to the
   workspace.
4. The `squadrules export` MCP tool can retrieve adapter content without
   filesystem access to the worktree.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Composition Patterns

**Multi-check compound command**
- chain with `&&`
- let the first failure stop execution

**Agent-readable shell status**
- use when failure can produce no output, especially `test`, quiet `grep`,
  JSON probes, pipelines, or commands that redirect stderr
- empty stdout or stderr is not success; success is the real process status
  reported as `solution.shell.exit_code`
- print the final status marker to stderr when stdout is machine-readable
- preserve the original status exactly:
  ```bash
  ( set -o pipefail; <command> ); rc=$?; printf '\nSQUADRULES_SHELL_EXIT=%s\n' "$rc" >&2; exit "$rc"
  ```
- keep `&&` inside `<command>` for ordered checks; use the final
  `; rc=$?; ...` trailer only to capture, print, and return the process status
- do not use `<command> || echo ERROR && false`; shell operators group
  left-to-right, so that form can fail after a successful command and it loses
  the original status

**Freeze-then-verify**
- step N writes checksum
- step N+1 verifies checksum before publish

**Write-then-grep**
- subagent writes a verdict file
- main agent checks the first line for `PASS`

**Phase-batch with critic**
- batch related TODO items into one phase
- verify hard artifacts with shell
- then call `critic-loop` for adversarial review

**Dry-run before execution**
- dry-run command
- human review
- real command

**Chain-link via forward + slug**
- layer N's contract requires `forward` with a specific adapter slug
- agent calls `forward` to start the next adapter (new `execution_id`)
- next adapter runs its own layer chain through to `reward`
- use when the protocol exceeds 350 lines or needs multi-path routing
- NOT a replacement for layers — layers remain the primary unit of work
- example contract:
  ```json
  {"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/implement-plan"}},"required":true}}
  ```

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The agent can now:
1. pick the correct challenge type for each protocol step
2. match challenge type to the step's mode
3. choose the right interpreter
4. apply working-directory and security rules
5. preserve real shell statuses for silent checks
6. use stronger verification patterns instead of weak narrative checks
