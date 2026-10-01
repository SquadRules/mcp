---
name: sqd-dev-bugfix-ship
description: >-
  squadrules-mcp: ship-ready bug workflow from report to merge. Reproduce on
  SQUADRULES-DEVELOPMENT, add failing dev test, minimal fix, dev deploy + dev:test,
  PR, watch CI, iterate until green, merge-ready summary. Use with
  reports/mcp-bug-*.md or user-requested SquadRules defect work.
---

# Bug fix: dev reproduce → test → PR → CI (squadrules-mcp)

**Repository:** `squadrules-mcp`. **Agent contract:** [`AGENTS.md`](https://github.com/SquadRules/mcp/blob/main/AGENTS.md).
**Build/test contract:** [`sqd-dev-build-test`](build-test.md).
**Skill index:** [`.agents/skills/README.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/README.md).

**Input:** A bug report under **`reports/`** (for example **`reports/mcp-bug-<slug>.md`**) or pasted content. If none exists, capture one first using **[`.agents/skills/squadrules/references/bug-report.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/references/bug-report.md)** (or your host's equivalent). This skill owns **fixing** once the report exists.

**Environment intent**

- **`SQUADRULES`**: Live. Treat it as authoritative for everything. When using it,
  you (the agent) act as a user and run workflows via the shipped
  [`.agents/skills/squadrules/SKILL.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/SKILL.md).
- **`SQUADRULES-DEVELOPMENT`**: Dev/QA instance for validating local code changes and
  reproducing defects during development.

---

## Flow (order matters; loop where noted)

### 1. Confirm on SQUADRULES-DEVELOPMENT

- Read the report: tool, arguments, expected vs actual, steps.
- Reproduce with **`SQUADRULES-DEVELOPMENT`**; read tool schemas from the host MCP
  descriptors before calling.
- If it reproduces → continue. If not → stop (stale report, wrong server, env
  drift); do not patch code for an unconfirmed symptom.

### 2. Failing automated test

- Add or extend a test under **`tests/`** (usually **`tests/integration/`**) that **fails on current behavior** and encodes the defect minimally.
- Run the narrowest command per **`sqd-dev-build-test`** until the failure is the right failure.

### 3. Implement fix

- Minimal change addressing root cause; no drive-by refactors.

### 4. Verify locally

```bash
npm run dev:deploy && npm run dev:test
```

Use **`npm run handoff`** or broader gates when the change scope demands it (see **`CONTRIBUTING.md`**).

### 5. Commit, push, PR

- Branch: **`fix/<topic>`** (or team convention).
- Clear commit message; push; open PR to **`main`**.

### 6. Monitor CI

- Watch required checks (`gh pr checks <n> --watch`, Actions UI).

### 7. CI red → return to step 3

Iterate until green or the user stops.

### 8. Merge-ready summary

When checks pass:

- Bug (one line) + dev confirmation (`SQUADRULES-DEVELOPMENT`).
- Test added (path + assertion intent).
- Fix (files / behavior).
- Commands run (`dev:deploy`, `dev:test`, …).
- PR URL + check status.

---

## MUST / MUST NOT

**MUST**

- Live MCP reproduction before coding when the defect is MCP-facing.
- Regression automation alongside or before the fix.
- Redact secrets in logs and PR bodies.

**MUST NOT**

- Declare fixed without **`dev:deploy`** + automated test signal.
- Compute or guess SquadRules **`proof_hash`**, **`nonce`**, or run IDs — echo server values per **`AGENTS.md`** / **`skills/squadrules`**.

---

## Related

- **[`sqd-dev-mcp-qa-e2e`](mcp-qa-e2e.md)** — strict phased MCP QA against **SQUADRULES-DEVELOPMENT** before filing mergeable reports.
- **`reports/mcp-bug-*.md`** — public bug report naming.
