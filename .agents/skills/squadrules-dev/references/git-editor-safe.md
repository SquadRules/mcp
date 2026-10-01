---
name: sqd-dev-git-editor-safe
description: >-
  squadrules-mcp: run Git from an agent shell without spawning an interactive editor as
  GIT_EDITOR (e.g. core.editor = code --wait). Use for rebase, merge --continue,
  rebase --continue, interactive rebase todo, or commit advice. Prefix
  GIT_EDITOR=true and GIT_SEQUENCE_EDITOR=true as needed.
---

# Git: editor-safe commands (agent terminal)

**Repository:** `squadrules-mcp`. **Skill index:** [`.agents/skills/README.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/README.md).

Maintainers often set **`core.editor = code --wait`**. When **this agent** runs Git in the terminal, prefix commands that may invoke an editor so the IDE does not block automation:

- **Rebase / merge / anything that might open an editor:**  
  `GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true <git …>`

Examples:

```bash
GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true git rebase origin/main
GIT_EDITOR=true git merge --continue
GIT_EDITOR=true git rebase --continue
```

Use **`git commit -m '…'`** with a real message so no editor is needed for commits.

**Note:** If the host still opens a rebase/merge **UI**, that is the IDE reacting to repo state; the shell cannot disable it. Repo-local `sequence.editor` (below) only affects Git's subprocess editor.

## Repo-local optional setting (this clone only)

Skip the interactive rebase todo editor without changing global `core.editor`:

```bash
git config sequence.editor true
```

(Re-apply after a fresh clone; stored in `.git/config`, not committed.)

## Related

- **[`sqd-dev-git-index-repair`](git-index-repair.md)** — index corruption / `write-tree` failures (combine with this skill for any editor-touching Git step).
