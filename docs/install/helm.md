# Helm Installation

The SquadRules MCP Helm chart has moved to its own repository.

**Chart repository:** [SquadRules/charts](https://github.com/SquadRules/charts)

## Install

```sh
helm install squadrules-mcp oci://ghcr.io/squadrules/charts/mcp --version <VERSION> \
  --namespace squadrules --create-namespace
```

For chart values, configuration and upgrade instructions, see the
[chart README](https://github.com/SquadRules/charts/blob/main/charts/mcp/README.md).
