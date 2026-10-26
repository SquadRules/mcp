# SquadRules adapter examples

This folder contains **markdown adapters ready for `train`** and a short reference for contract types and solution shapes. These examples are the canonical source for **dev/qa workflow tests**: imports, activate + run, update layer, and update adapter.

## Structural rules (hard-enforced)

All examples in this folder conform to the structural validation rules:

- **Shell contracts must name an interpreter** — one of `bash`, `sh`, `python3`, `python`, `node`. Absent interpreter is rejected with `shell_interpreter_required` ([ADR 0026](../adr/0026-shell-interpreter-required.md)). A multi-step check ships as an artifact gate script rather than an inline one-liner ([ADR 0031](../adr/0031-gate-scripts-as-adapter-artifacts.md), [example](artifact-gate/adapter-example-artifact-gate.md)).
- **Forward contracts link to another adapter only** — `forward.target` matching `squadrules://adapter/<slug>`. Bare tool calls are rejected with `forward_link_only` ([ADR 0028](../adr/0028-forward-contract-type-rename.md), superseding [ADR 0025](../adr/0025-mcp-contract-forward-link-only.md)).
- **`subagent` is a valid contract type** — for delegated judgment or delegated MCP tool work ([ADR 0024](../adr/0024-adapter-contract-verification-ladder.md) §2). Its optional `subagent.mcp` list names the real tool calls the subagent must make; a malformed list is rejected with `subagent_mcp_invalid` ([ADR 0029](../adr/0029-subagent-mcp-and-context-authority.md)).

## Example adapters

Each file below is a complete adapter (H1 title + H2 steps with ````json` contract blocks). Every example ends with a **final step** with no challenge: "Show the output from [prior step(s)] to the user." Only reachable after all prior contracts are solved.

| File | Contract type(s) | MCP-only (no shell) |
| ---- | ---------------- | ------------------- |
| [adapter-example-shell.md](adapter-example-shell.md) | shell | No |
| [adapter-example-artifact-gate.md](artifact-gate/adapter-example-artifact-gate.md) | shell | No |
| [adapter-example-forward.md](adapter-example-forward.md) | shell, forward | No |
| [adapter-example-subagent.md](adapter-example-subagent.md) | subagent | Yes |
| [adapter-example-user-input.md](adapter-example-user-input.md) | user_input | Yes |
| [adapter-example-comment.md](adapter-example-comment.md) | comment | Yes |
| [adapter-example-all-types.md](adapter-example-all-types.md) | shell, forward, subagent, user_input, comment | No |
| [adapter-twelve-step-linear-test.md](adapter-twelve-step-linear-test.md) | comment ×12 | Yes |

**MCP-only** means the adapter has no `shell` contract; safe for workflow tests that forbid shell and local filesystem (only MCP tools and writing to `reports/`).

## Use in dev/qa workflow tests

- **Imports:** Train each example below via **`train`** (e.g. from integration tests or an agent). See [Workflow test README](../../tests/workflow-test/README.md).
- **Activate + run:** After training, use **`activate`** → pick a choice → **`forward`** (loop with `solution` per layer) until **`reward`** completes the run.
- **Update layer / update adapter:** Use **`activate`** or an existing URI, **`export`** for content, then **`tune`** with edited `content` (one layer or multiple URIs).

When running **MCP-only** workflow tests (no shell, no filesystem except `reports/`), use only the MCP-only adapters above or adapters you train that contain no shell step.

## Reference

- **[Contract types](challenge-types.md)** — Table of trainable example docs, how to train, structural rules per type, and solution shapes for `forward`.

## Related docs

- [Architecture and adapter workflows (project Wiki)](https://github.com/SquadRules/mcp/wiki) — End-to-end flow (**activate** → **forward** → **reward**) and per-tool workflows.
- [Workflow test README](../../tests/workflow-test/README.md) — Test harness and how to run.
- Building SquadRules workflows is described in the tool descriptions for
  **`train`** and **`forward`**.
- [Agent-facing design principles](../../CONTRIBUTING.md#agent-facing-design-principles) — For contributors designing or reviewing MCP tools and APIs.
