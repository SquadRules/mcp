---
version: "5.11.0"
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

Choose the **strongest verifiable contract** for each step — an objective,
empirically checkable proof beats a narrative one. The verification ladder, in
preferred order:

1. **Shell empirical check** — run a command that observes the real artifact
   (file, git state, command output, exit code). This is the default proof.
2. **Critic-loop subagent** — when a step's result cannot be shell-verified,
   delegate an adversarial review to the `critic-loop` adapter via a `subagent`
   contract.
3. **Subagent instructed to call an MCP tool** — when the only way to complete a
   step is a real MCP call (`train`/`tune`/`export`/`forward`/…), use a
   `subagent` contract whose `context` instructs the delegate to make that call
   and report the result.
4. **Fallback: a single `comment` contract with an AI ACK** — only for read-only
   or knowledge-only adapters, where no artifact exists to check.

**Per-adapter contract-count rules:**
- Every adapter carries **at least one** contract: a `shell` check for executable
  adapters, or a single `comment` ACK for knowledge-only adapters.
- Ideally one **aggregate shell proof** per adapter, plus an additional `shell`
  precondition check before every hard-to-undo boundary (canonical example:
  assert the branch is not `main` and is a task worktree before commit/push).
- `subagent` contracts: as many as make sense for the steps that need them.
- **At most one `comment`** contract per adapter, and it is **never mixed** with
  other contract types in the same adapter.
- Any contract whose result cannot be empirically shell-verified must be followed
  by a **critic-loop `subagent` call before reward**.

**`user_input` is an emergency-only gate.** Use it only when a human gate is
absolutely a must: (a) the human explicitly requires involvement, or (b) the
operation is dangerous and a human answer materially boosts the agent's
confidence. Never use it as an approval gate after a critic FAIL, and never as a
routine confirmation. Default behaviour is full-autonomy, end-to-end execution —
hard blockers are reported and stopped, not pushed to the human for permission.

**Mode before challenge type:**
- **execute or verify local state** → `shell`
- **review / delegate / call an MCP tool** → `subagent`
- **genuine human emergency gate** → `user_input`
- **pure knowledge, no observable artifact** → a single `comment` ACK

### Decision Tree

```
Does the step produce or verify a file, command result, or system state?
 ├─ YES → "shell" (empirical check; the default)
 └─ NO → Does the step need a critic review, delegation, or a real MCP tool call?
          ├─ YES → "subagent" (context names the review/tool/slug to delegate)
          └─ NO → Is this a genuine human emergency gate?
                   ├─ YES → "user_input" (only the two emergency conditions)
                   └─ NO → a single "comment" ACK (read-only / knowledge-only only)
```

### Challenge JSON Formats

The example blocks below are indented so this guide parses as a single `comment`
ACK; de-indent them when you author an adapter.

**shell**
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"<command>","interpreter":"bash","timeout_seconds":30},"required":true}}
  ```

`interpreter` is **required** (no default) and accepts exactly `bash | sh |
python3 | python | node`. `train` / `tune` reject a shell contract that omits it,
so every shell gate must name the runtime it executes under. The invoker maps each
interpreter: `bash`/`sh` run `-c <cmd>`, `python3`/`python` inject `-c`, `node`
injects `-e`. `flags`, `args` and `workdir` are supported too. The forward shell
contract surfaces `cmd`, `timeout_seconds` and `interpreter`, `flags`, `args`,
`workdir`. See **Interpreter Selection** below for when to pick each interpreter.

**user_input** *(emergency-only — see Core Rules)*
  ```json
  {"contract":{"type":"user_input","user_input":{"prompt":"<specific question>"},"required":true}}
  ```

**comment** *(fallback-only — a single ACK per read-only / knowledge-only
adapter, never mixed with other types)*
  ```json
  {"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
  ```

**subagent**
  ```json
  {"contract":{"type":"subagent","subagent":{"context":"<task description>"},"required":true}}
  ```

Use `subagent` when a step delegates work to another agent — a critic-loop
review, or a real MCP tool call (`train`/`tune`/`export`/`forward`) the subagent
is instructed to make. The `context` names the target or tool. The mandatory
delegation instruction is appended by the server to the forward response
`message` (`SUBAGENT_DELEGATION: …`), not stored inside the contract.

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

**subagent solution**
```json
{
  "type": "subagent",
  "outcome": "success",
  "evidence": {
    "report": "<the actual subagent report — verdict, tool-result summary, or analysis>"
  }
}
```

A subagent proof accepts any non-empty `report`, so the report text alone is a
weak gate. When the step is a critic review, the objective guard is the following
`shell` FAIL-gate on the verdict file, not the report body.

## Interpreter Selection

Only `bash`, `sh`, `python3`, `python` and `node` are valid `interpreter`
values. Non-enum values (`perl`, `ruby`, `terraform`, `docker`, `npm`, …) are
rejected by the contract schema — build tools are wrapped in a `bash -c`
command, and text/data processing that once leaned on Perl now uses `python3`.

| Task | Use bash | Use python3 | Use node |
|---|---|---|---|
| File exists, tool installed, git state | yes | no | no |
| Simple content grep | yes | no | no |
| Multi-line regex | no | yes | no |
| Paragraph processing | no | yes | no |
| JSON validation | maybe | yes | yes |
| YAML / complex data structure checks | no | yes | no |

**Rule of thumb:** if bash requires `while read`, `grep | awk`, or heavy quote
escaping, use `python3` (or `node` for JS-native data). Reach for an interpreter
only when the shell genuinely cannot express the check.

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
- dry-run command (objective `shell` precondition)
- critic-loop `subagent` review of the plan when the change is hard to undo
- real command

**Chain-link via subagent delegation**
- layer N carries a `subagent` contract whose `context` instructs the delegate to
  call `forward` on a specific adapter slug
- the delegate starts the next adapter (new `execution_id`) and reports back
- the objective guard is a following `shell` FAIL-gate on the verdict/result file
- use when the protocol exceeds 350 lines or needs multi-path routing
- NOT a replacement for layers — layers remain the primary unit of work
- example contract (indented so this guide parses as its single ACK):
  ```json
  {"contract":{"type":"subagent","subagent":{"context":"Call forward with uri=squadrules://adapter/implement-plan and report the first layer returned."},"required":true}}
  ```

## Artifacts for Shell Contracts

When a shell contract needs a reusable script (Python guard, validation logic,
setup helper), **attach it as an artifact** rather than inlining it in the
contract JSON:

1. Write the script file.
2. `train` with `mime: "text/x-python"`, `artifact_name: "isolation-guard.py"`,
   `adapter_uri: "squadrules://adapter/my-adapter"`, and the script content in
   `content`.
3. In the shell contract, reference it via `export` with
   `squadrules://artifact/{uuid}` at execution time.

This keeps adapter markdown clean, makes scripts independently versionable,
and avoids bloating contract JSON with large inline scripts.

**Interpreter restriction:** The `interpreter` field in shell contracts accepts
only: `bash`, `sh`, `python3`, `python`, `node`. Build tools (`terraform`,
`docker`, `npm`, etc.) are **not** interpreters — wrap them in a `bash -c`
command instead.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

> **Migration note:** the former `mcp` contract type no longer exists — steps
> that need a real MCP tool call or an adapter chain-link are delegated through a
> `subagent` contract whose `context` names the target.

The agent can now:
1. pick the correct challenge type for each protocol step
2. match challenge type to the step's mode
3. choose the right interpreter
4. apply working-directory and security rules
5. preserve real shell statuses for silent checks
6. use stronger verification patterns instead of weak narrative checks
