---
name: mcp-host-bridge
description: >-
  kairos-mcp: MCP server selection and host-bridge troubleshooting. Defines the
  intended use of KAIROS, KAIROS-DEVELOPMENT, and KAIROS-HELM-INTEGRATION, plus
  how to resolve config keys to agent-visible server ids when MCP calls fail.
---
<!-- squadrules-compat-surface: skill directory + name: frontmatter (kairos / kairos-dev) are retained invocation identifiers; path/filename rename is an explicit non-goal and body prose references these names plus the retained kairos CLI alias -->

# MCP host bridge (kairos-mcp)

This skill defines the intended use of each KAIROS MCP environment and gives
host-bridge troubleshooting steps for server-id and authentication failures.
Use it when MCP calls fail with 401/403, “MCP server does not exist,” or when
you are unsure which server is authoritative for the task.

## Environments

This repository commonly uses three MCP server instances. Each one has a
different purpose and authority boundary.

- **`KAIROS`**: Live server. Treat it as authoritative for everything and use it
  with the shipped [kairos skill](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/skills/kairos/SKILL.md). In this
  environment, you (the agent) act as a user, not a developer.
- **`KAIROS-DEVELOPMENT`**: Development instance built from this worktree,
  configured at the project level in [mcp.json](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/mcp.json). Use it as a
  developer/QA to validate local code changes.
- **`KAIROS-HELM-INTEGRATION`**: Kubernetes instance built from the Helm chart in
  `helm/`, configured at the project level in [mcp.json](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/mcp.json). Use it
  as a developer/QA of the Helm chart to validate the deployment process and app
  availability. The app version can vary.

## Server id resolution

Many hosts do not use the config key as the runtime `server` identifier. Resolve
the agent-visible id before retrying calls.

1. Trigger a minimal MCP call using your configured key.
2. If the host reports “MCP server does not exist,” read the error’s
   **Available servers** list (or the host’s MCP panel).
3. Pick the entry that corresponds to your configured server, often the one
   whose id ends with the config key, for example `-KAIROS-DEVELOPMENT`.

## Auth and availability failures

If MCP calls fail with 401/403, or tools are missing unexpectedly, treat it as a
host configuration or authentication problem and fix it before continuing.

- Verify the host points at the intended environment (`KAIROS`,
  `KAIROS-DEVELOPMENT`, or `KAIROS-HELM-INTEGRATION`).
- Re-authenticate in the host if the environment requires login.
- Re-run the minimal call and confirm the tool list matches the connected
  server’s runtime surface.

## Authority split

When results differ between environments, use this rule to decide what is
authoritative.

- For runtime tool names, schemas, and responses: treat the **connected server**
  as authority.
- For any user-facing behavior or “what is true”: treat **`KAIROS`** as
  authoritative.
- For local implementation changes and regression tests: use
  **`KAIROS-DEVELOPMENT`** and this worktree.
