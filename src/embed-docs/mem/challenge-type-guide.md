---
version: "5.12.0"
slug: challenge-type-guide
title: Challenge Type Selection Guide
---

# Challenge Type Selection Guide

Decision rules, JSON formats, interpreter selection, and anti-patterns for
choosing SQUADRULES challenge types. Loaded by adapter-authoring agents during
drafting and review.

## Activation Patterns

**Typically invoked by:** `author-adapter` and `critic-loop`.

**Can be invoked directly when agent needs:**
- "challenge type reference" / "which challenge type to use"
- "how to write shell challenges" / "challenge format"
- "interpreter selection for challenges"

**Trigger pattern:** **challenge** + (type | format | selection | guide).

**Must Never:**
- Be used as an execution adapter.
- Select `comment` merely because it is easy.

**Must Always:**
- Be consulted before assigning challenge types to adapter steps.
- Choose the strongest observable contract available.
- Match challenge choice to the mode of the step: ask, decide, act, verify, or review.

**Good trigger examples:**
- drafting a new adapter and need challenge types → load this
- reviewing challenge type selection in a draft → load this

**Bad trigger examples:**
- "Create a new adapter" → use `author-adapter`
- "Review my adapter draft" → use `critic-loop`

## Core Rules

`comment` is the challenge type of **last resort**. If a step produces any
observable artifact — a file, a git state change, an API response, or an exit
code — use `shell` or `subagent` instead.

**Mode before challenge type:**
- **clarify / approve** → `user_input`
- **chain to another adapter** → `mcp` (forward-link only)
- **execute or verify local state** → `shell`
- **delegate to another agent** → `subagent`
- **pure reasoning with no observable artifact** → `comment`

### Decision Tree

```
Does the step chain to another adapter via forward?
 ├─ YES → "mcp" forward-link (tool_name: "forward", arguments.uri: squadrules://adapter/<slug>)
 └─ NO → Does the step produce or verify a file, command result, or system state?
          ├─ YES → "shell" (with interpreter)
          └─ NO → Does the step require human approval or choice?
                   ├─ YES → "user_input"
                   └─ NO → Does the step delegate work to another agent?
                            ├─ YES → "subagent"
                            └─ NO → "comment" (last resort — no stronger contract possible)
```

### Challenge JSON Formats

**shell** (interpreter is REQUIRED)
```json
{"contract":{"type":"shell","shell":{"cmd":"<command>","interpreter":"bash","timeout_seconds":30},"required":true}}
```

Allowed interpreters: `bash`, `sh`, `python3`, `python`, `node`. Build tools
(`terraform`, `docker`, `npm`, etc.) are **not** interpreters — wrap them in a
`bash` command instead.

**mcp** (forward-link only — bare tool_name checks are not valid)
```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/<slug>"}},"required":true}}
```

The server validates that `solution.mcp.arguments` is a superset of the
contract's `mcp.arguments` (subset/deep matching), proving the agent called
`forward` with the correct target slug.

**user_input**
```json
{"contract":{"type":"user_input","user_input":{"prompt":"<specific question>"},"required":true}}
```

**subagent**
```json
{"contract":{"type":"subagent","subagent":{"instruction":"<task description>"},"required":true}}
```

Use `subagent` when a step delegates work to another agent (human or AI) rather
than executing it directly. The `instruction` field provides task-specific
guidance. Evidence of completion is collected via the anti-cheat evidence gate.

**comment** (last resort — max 1 per adapter, closing ACK only)
```json
{"contract":{"type":"comment","comment":{"min_length":50},"required":true}}
```

### Solution JSON Formats

Every solution follows the same envelope:

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
{"type":"shell","outcome":"success","evidence":{"exit_code":0,"stdout":"...","stderr":"","duration_seconds":1.2}}
```

**mcp solution**
```json
{"type":"mcp","outcome":"success","evidence":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"},"response":{}}}
```

**subagent solution**
```json
{"type":"subagent","outcome":"success","evidence":{"agent_id":"agent-uuid","artifacts":["path/to/output"],"summary":"Task completed"}}
```

**comment solution**
```json
{"type":"comment","outcome":"success","evidence":{"text":"Verified all items are complete."}}
```

**user_input solution**
```json
{"type":"user_input","outcome":"success","evidence":{"confirmation":"agreed. proceed","timestamp":"2026-05-18T14:49:00Z"}}
```

## Interpreter Selection

| Task | Interpreter |
|---|---|
| File exists, tool installed, git state | `bash` |
| Simple content grep | `bash` |
| Multi-line regex or paragraph processing | `python3` |
| JSON validation | `bash` (jq) or `python3` |
| YAML / complex data structure checks | `python3` |
| Node.js ecosystem tools | `node` |

**Rule of thumb:** default to `bash`. If you need multi-line regex, imports for
data formats, or complex string processing, use `python3`. Use `node` only when
the check requires the Node.js runtime.

## Security and Working Directory Rules

Use `$SQUADRULES_LOCAL_ARTIFACT_DIR` as the base directory for local handoff
artifacts. File paths within it are provided as variables by the invoking agent
to avoid collisions between parallel sessions.

**Rules:**
- all file paths in shell challenges reference variables (e.g., `$DRAFT_FILE`,
  `$VERDICT_FILE`) set by the parent agent — never hardcode filenames
- the parent agent constructs collision-free paths under
  `$SQUADRULES_LOCAL_ARTIFACT_DIR`
- when using SQUADRULES MCP, the latest `activate` / `forward` / `next` response
  field `squadrules_local_artifact_dir` is an ordered array of URI hints
  (`project://<rel>`, `user://<rel>`); pick one, resolve on your machine, and
  `export SQUADRULES_LOCAL_ARTIFACT_DIR="<absolute>"`
- prerequisites create the directory; Reward Signal cleans it up
- never write credentials or secrets to files

### Resolving `project://` and `user://` URI hints

| Scheme | Resolution | Example |
|--------|-----------|--------|
| `project://<rel>` | `<IDE project root>/<rel>` | `project://.local/squadrules/work` |
| `user://<rel>` | `<$XDG_CONFIG_HOME or $HOME>/<rel>` | `user://.config/squadrules/work` |

When your session spans multiple projects, prefer `user://` to avoid ambiguity.

### Worktree placement (for task-isolation adapters)

When an adapter requires a git worktree for isolation, the worktree path MUST
be **outside** every existing checkout:

```
REPO_ROOT=/home/user/repos/my-project
# RIGHT: sibling of the repo
WT=/home/user/repos/mcp.worktrees/<task-id>
# WRONG: inside the checkout
# WT=/home/user/repos/my-project/.mcp.worktrees/<task-id>
```

**Rule of thumb:** `$(dirname "$REPO_ROOT")/mcp.worktrees/<task-id>`

### IDE worktree access limitations

Most IDE file tools scope operations to the open project root. They **cannot**
reach worktrees placed outside `$REPO_ROOT`. Use the terminal/shell tool for
external worktrees, or open the worktree as a separate project window.

## Composition Patterns

**Multi-check compound command** — chain with `&&`, let the first failure stop.

**Agent-readable shell status** — preserve the original exit status:
```bash
( set -o pipefail; <command> ); rc=$?; printf '\nSQUADRULES_SHELL_EXIT=%s\n' "$rc" >&2; exit "$rc"
```

**Freeze-then-verify** — step N writes checksum, step N+1 verifies before publish.

**Write-then-grep** — subagent writes a verdict file, main agent checks line 1.

**Phase-batch with critic** — batch related items, verify hard artifacts with
shell, then call `critic-loop` for adversarial review.

**Chain-link via forward + slug** — layer N's contract requires `forward` with a
specific adapter slug. Use when the adapter exceeds 350 lines or needs
multi-path routing. Example:
```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/implement-plan"}},"required":true}}
```

## Artifacts for Shell Contracts

When a shell contract needs a reusable script, **attach it as an artifact**
rather than inlining it in the contract JSON:

1. Write the script file.
2. `train` with `mime: "text/x-python"`, `artifact_name: "isolation-guard.py"`,
   `adapter_uri: "squadrules://adapter/my-adapter"`, and the script content.
3. In the shell contract, reference it via `export` with
   `squadrules://artifact/{uuid}` at execution time.

This keeps adapter markdown clean and makes scripts independently versionable.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The agent can now:
1. pick the correct challenge type for each adapter step
2. match challenge type to the step's mode
3. choose the right interpreter (bash, python3, node)
4. apply working-directory and security rules
5. use forward-link mcp contracts for chain links
6. use subagent contracts for delegated work
7. apply stronger verification patterns instead of weak comment checks
