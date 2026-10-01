---
name: sqd-dev-git-index-repair
description: >-
  squadrules-mcp: recover Git index / write-tree failures (invalid object, Error
  building trees) after long pre-commit, especially in worktrees. Covers Husky
  bisection, fs_usage on macOS, read-tree repair, and .husky/pre-commit cleanup
  behavior — read the hook file as authority, not a stale copy of this skill.
---

# Git worktree index and commit repair

**Repository:** `squadrules-mcp`. **Skill index:** [`.agents/skills/README.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/README.md).
**Hook authority:** [`.husky/pre-commit`](https://github.com/SquadRules/mcp/blob/main/.husky/pre-commit) (always re-read before automating).

## When to use

- **`error: invalid object …`**
- **`error: Error building trees`**
- Failure **after** a long **`pre-commit`** (for example **`npm run lint`**)
- **`git write-tree`** fails while staging looks plausible

## Root cause

The **index** references a **blob OID** not present in this repo's object database. Worktrees share **one** `.git/objects` store with the main repo; corruption or GC there affects every worktree.

Common phantom-entry sources:

- IDE background **`git status` / `git diff`** refreshing a stale index.
- Paths staged once; blob later pruned by **`git gc`** while index still references it.

### Diagnosis with fs_usage (macOS)

```sh
sudo fs_usage -w -f filesys | grep 'worktrees/<name>/index'
```

Trigger the hook in another terminal; look for **`WrData`** + **`rename`** on the index. In this repo, tracing showed only **`git`** writes the index; IDE helpers may read.

## Bisect Husky (recommended)

When failure correlates with hooks:

1. Rebuild a sane index (see [Manual repair](#manual-repair-canonical)); avoid blind **`git add -A`** while debugging.
2. Disable one **`pre-commit`** step at a time (start with **`npm run lint`** — longest window). This repo's hook may run **`git rm --cached`** on missing blobs **before and after** lint — confirm in **`.husky/pre-commit`**.
3. Trace: `sh -x .husky/pre-commit 2>&1 | tee /tmp/precommit.trace`
4. Emergency: **`HUSKY=0 git commit`** only with explicit follow-up to run the same checks in CI or locally afterward.

**Interpretation**

- Fails only when lint runs → concurrent index activity or phantom paths mid-hook; trust the hook's documented cleanup passes.
- Fails with hook disabled → suspect **`git fsck`** / missing objects, not ESLint.

### What does not work

Rebuilding the index **inside** the hook (`read-tree` + `add -A` in a trap) races IDE git processes — **do not** add that pattern.

## Manual repair (canonical)

From the affected worktree repo root:

```sh
git read-tree HEAD
git add -A
git write-tree >/dev/null && echo "index OK"
```

- **`read-tree HEAD`** — index from current commit tree.
- **`add -A`** — layer working tree changes.
- If **`write-tree`** still fails, **do not** commit.

For minimal stages, use **`git add <paths>`** after **`read-tree HEAD`** instead of **`add -A`**.

## Drop one bad path

```sh
git rm --cached -f --ignore-unmatch <path>
git add -A
git write-tree >/dev/null && echo "index OK"
```

## Repository health

```sh
git fsck --no-progress 2>&1 | head -50
```

Missing blobs → **`git fetch`** from a complete remote; repair may require the **main** repo's object store.

## Prevention

- **`git.autoRefresh: false`** in **`.vscode/settings.json`** for heavy worktree workflows.
- **`git gc`** awareness when many worktrees share one object DB.

## Agent notes

- Combine with **[`sqd-dev-git-editor-safe`](git-editor-safe.md)** for any Git step that might open an editor.
- Do not force-add ignored secrets dirs unless the user explicitly requests it.

## Related

- **[`sqd-dev-build-test`](build-test.md)** — after repair, run **`npm run lint`** / **`npm run handoff`** as appropriate.
