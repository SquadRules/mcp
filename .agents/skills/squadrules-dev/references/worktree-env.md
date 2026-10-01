---
name: sqd-dev-worktree-env
description: >-
  squadrules-mcp: git worktrees do not share .env* with the main checkout. Explains
  automatic copy on first dev command, manual sync from main, Run Task, and
  unique PORT/METRICS_PORT per worktree when several stacks run on one machine.
  Use when .env is missing, ports clash, after secrets change in main, 401/auth
  in tests, or user says copy/sync .env or worktree env.
---

# Worktree `.env` (squadrules-mcp)

**This repository is often used as a git worktree.** Dotenv files (`.env`, `.env.dev_simple`, etc.) live in the worktree root and are **not** shared with other worktrees.

## Unique ports per worktree (same host)

Copying **`.env*`** from main duplicates **`PORT`**, **`METRICS_PORT`**, and URLs that embed the app port (for example **`AUTH_CALLBACK_BASE_URL`** in **`scripts/env/.env.template`**). If **more than one worktree** (or main + a worktree) runs the app, tests, or MCP against **localhost** on the **same machine**, **each worktree needs its own free port pair** so listeners do not collide.

**Minimum edits after copy (typical `dev` profile):**

- Set **`PORT`** to a free host port (not used by another squadrules-mcp checkout or service).
- Set **`METRICS_PORT`** to another free port.
- Set **`AUTH_CALLBACK_BASE_URL`** (and any other **`http://localhost:<port>`** dev URLs that must match the app) to use the same host and **`PORT`** as the server you start in this worktree.

**`dev_simple`:** **`deploy-run-env.sh`** defaults **`PORT`** to **4300** and **`METRICS_PORT`** to **9490** when unset (see **`ENV=dev_simple`**). If another checkout already uses those ports on the same host, override **`PORT`** and **`METRICS_PORT`** in this worktree's **`.env`** / **`.env.dev_simple`**.

**Docker / infra:** if each worktree runs a **full** Compose stack on one machine, published ports on shared services (Qdrant, Valkey, Keycloak, etc.) can also conflict; resolving that is separate from app **`PORT`** and may require different Compose project names, profiles, or host port overrides — not all of that is driven by **`.env`** alone.

## Automatic behaviour (no manual step)

When **`./scripts/deploy-run-env.sh`** runs (via **`npm run dev:*`** targets such as **`dev:deploy`**, **`dev:restart`**, **`dev:test`**, and related commands): if **`.env`** is missing, it runs **`./scripts/deploy-copy-env-from-main.sh`** and continues. That script resolves the **main** worktree with **`git worktree list`** (first line), copies every **`.env*`** file that exists as regular files there into the current worktree, and is a **no-op** when you are already in the main worktree.

## When to run the script manually

- **Refresh secrets** from main after someone updates `.env` there.
- **Copy before** a command that does not go through `deploy-run-env.sh` but still needs env (rare).
- **Agent shell:** from the worktree repo root:

```bash
./scripts/deploy-copy-env-from-main.sh
```

## Script name (do not drift)

The repo ships **`scripts/deploy-copy-env-from-main.sh`**. There is no `copy-env-from-main.sh` in this tree; older docs or rules that mention that name should be updated to **`deploy-copy-env-from-main.sh`**.

## Related

- **[`sqd-dev-build-test`](build-test.md)** — full **`npm run dev:deploy`** then **`npm run dev:test`** flow (deploy path triggers the automatic copy when `.env` is absent).
- **`scripts/README.md`** — script index for `deploy-run-env.sh` and `deploy-copy-env-from-main.sh`.
