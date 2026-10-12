# SquadRules adapter examples

This folder contains **markdown adapters ready for `train`** and a short reference for challenge types and solution shapes. These examples are the canonical source for **dev/qa workflow tests**: imports, activate + run, update layer, and update adapter.

## Example adapters

Each file below is a complete adapter (H1 + H2 steps with ````json` challenge blocks). Every example ends with a **final step** with no challenge: "Show the output from [prior step(s)] to the user." Only reachable after all prior challenges are solved. The agent just shows the prior output to the user; no additional challenge to solve.


| File                                                             | Challenge type(s)               | MCP-only (no shell) |
| ---------------------------------------------------------------- | ------------------------------- | ------------------- |
| [adapter-example-shell.md](adapter-example-shell.md)           | shell                           | No                  |
| [adapter-example-user-input.md](adapter-example-user-input.md) | user_input                      | Yes                 |
| [adapter-example-comment.md](adapter-example-comment.md)       | comment                         | Yes                 |
| [adapter-example-mcp.md](adapter-example-mcp.md)               | mcp                             | Yes                 |
| [adapter-example-all-types.md](adapter-example-all-types.md)   | shell, mcp, user_input, comment | No                  |


**MCP-only** means the adapter has no `shell` challenge; safe for workflow tests that forbid shell and local filesystem (only MCP tools and writing to `reports/`).

## Use in dev/qa workflow tests

- **Imports:** Train each example below via **`train`** (e.g. from integration tests or an agent). See [Workflow test README](../../tests/workflow-test/README.md).
- **Activate + run:** After training, use **`activate`** → pick a choice → **`forward`** (loop with `solution` per layer) until **`reward`** completes the run.
- **Update layer / update adapter:** Use **`activate`** or an existing URI, **`export`** for content, then **`tune`** with edited `content` (one layer or multiple URIs).

When running **MCP-only** workflow tests (no shell, no filesystem except `reports/`), use only the MCP-only adapters above or adapters you train that contain no shell step.

## Reference

- **[Challenge types](challenge-types.md)** — Table of trainable example docs, how to train, and solution shapes for `forward`.

## Related docs

- [Architecture and adapter workflows (project Wiki)](https://github.com/SquadRules/mcp/wiki) — End-to-end flow (**activate** → **forward** → **reward**) and per-tool workflows.
- [Workflow test README](../../tests/workflow-test/README.md) — Test harness and how to run.
- Building SquadRules workflows is described in the tool descriptions for
  **`train`** and **`forward`**.
- [Agent-facing design principles](../../CONTRIBUTING.md#agent-facing-design-principles) — For contributors designing or reviewing MCP tools and APIs.

