---
name: kmcp-dev-bugfix-ship
description: >-
  kairos-mcp: ship-ready bug workflow from report to merge. Reproduce on
  KAIROS-DEVELOPMENT, add failing dev test, minimal fix, dev deploy + dev:test,
  PR, watch CI, iterate until green, merge-ready summary. Use with
  reports/mcp-bug-*.md or user-requested KAIROS defect work.
---
<!-- squadrules-compat-surface: skill directory + name: frontmatter (kairos / kairos-dev) are retained invocation identifiers; path/filename rename is an explicit non-goal and body prose references these names plus the retained kairos CLI alias -->

# Bug fix: dev reproduce → test → PR → CI (kairos-mcp)

**Repository:** `kairos-mcp`. **Agent contract:** [`AGENTS.md`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/AGENTS.md).
**Build/test contract:** [`kmcp-dev-build-test`](build-test.md).
**Skill index:** [`.agents/skills/README.md`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/skills/README.md).

**Input:** A bug report under **`reports/`** (for example **`reports/mcp-bug-<slug>.md`**) or pasted content. If none exists, capture one first using **[`.agents/skills/kairos/references/bug-report.md`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/skills/kairos/references/bug-report.md)** (or your host’s equivalent). This skill owns **fixing** once the report exists.

**Environment intent**

- **`KAIROS`**: Live. Treat it as authoritative for everything. When using it,
  you (the agent) act as a user and run workflows via the shipped
  [`.agents/skills/kairos/SKILL.md`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/skills/kairos/SKILL.md).
- **`KAIROS-DEVELOPMENT`**: Dev/QA instance for validating local code changes and
  reproducing defects during development.

---

## Flow (order matters; loop where noted)

### 1. Confirm on KAIROS-DEVELOPMENT

- Read the report: tool, arguments, expected vs actual, steps.
- Reproduce with **`KAIROS-DEVELOPMENT`**; read tool schemas from the host MCP
  descriptors before calling.
- If it reproduces → continue. If not → stop (stale report, wrong server, env
  drift); do not patch code for an unconfirmed symptom.

### 2. Failing automated test

- Add or extend a test under **`tests/`** (usually **`tests/integration/`**) that **fails on current behavior** and encodes the defect minimally.
- Run the narrowest command per **`kmcp-dev-build-test`** until the failure is the right failure.

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

- Bug (one line) + dev confirmation (`KAIROS-DEVELOPMENT`).
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
- Compute or guess KAIROS **`proof_hash`**, **`nonce`**, or run IDs — echo server values per **`AGENTS.md`** / **`skills/kairos`**.

---

## Related

- **[`kmcp-dev-mcp-qa-e2e`](mcp-qa-e2e.md)** — strict phased MCP QA against **KAIROS-DEVELOPMENT** before filing mergeable reports.
- **`reports/mcp-bug-*.md`** — public bug report naming.
