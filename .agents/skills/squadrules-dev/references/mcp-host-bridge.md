---
name: mcp-host-bridge
description: >-
  squadrules-mcp: MCP server selection and host-bridge troubleshooting. Defines the
  intended use of SquadRules, SQUADRULES-DEVELOPMENT, and SQUADRULES-HELM-INTEGRATION, plus
  how to resolve config keys to agent-visible server ids when MCP calls fail.
---

# MCP host bridge (squadrules-mcp)

This skill defines the intended use of each SquadRules MCP environment and gives
host-bridge troubleshooting steps for server-id and authentication failures.
Use it when MCP calls fail with 401/403, "MCP server does not exist," or when
you are unsure which server is authoritative for the task.

## Environments

This repository commonly uses three MCP server instances. Each one has a
different purpose and authority boundary.

- **`SQUADRULES`**: Live server. Treat it as authoritative for everything and use it
  with the shipped [squadrules skill](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/SKILL.md). In this
  environment, you (the agent) act as a user, not a developer.
- **`SQUADRULES-DEVELOPMENT`**: Development instance built from this worktree,
  configured at the project level in [mcp.json](https://github.com/SquadRules/mcp/blob/main/.agents/mcp.json). Use it as a
  developer/QA to validate local code changes.
- **`SQUADRULES-HELM-INTEGRATION`**: Kubernetes instance built from the Helm chart in
  `helm/`, configured at the project level in [mcp.json](https://github.com/SquadRules/mcp/blob/main/.agents/mcp.json). Use it
  as a developer/QA of the Helm chart to validate the deployment process and app
  availability. The app version can vary.

## Server id resolution

Many hosts do not use the config key as the runtime `server` identifier. Resolve
the agent-visible id before retrying calls.

1. Trigger a minimal MCP call using your configured key.
2. If the host reports "MCP server does not exist," read the error's
   **Available servers** list (or the host's MCP panel).
3. Pick the entry that corresponds to your configured server, often the one
   whose id ends with the config key, for example `-SQUADRULES-DEVELOPMENT`.

## Auth and availability failures

If MCP calls fail with 401/403, or tools are missing unexpectedly, treat it as a
host configuration or authentication problem and fix it before continuing.

- Verify the host points at the intended environment (`SQUADRULES`,
  `SQUADRULES-DEVELOPMENT`, or `SQUADRULES-HELM-INTEGRATION`).
- Re-authenticate in the host if the environment requires login.
- Re-run the minimal call and confirm the tool list matches the connected
  server's runtime surface.

## Authority split

When results differ between environments, use this rule to decide what is
authoritative.

- For runtime tool names, schemas, and responses: treat the **connected server**
  as authority.
- For any user-facing behavior or "what is true": treat **`SQUADRULES`** as
  authoritative.
- For local implementation changes and regression tests: use
  **`SQUADRULES-DEVELOPMENT`** and this worktree.
