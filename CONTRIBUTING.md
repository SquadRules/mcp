# Contributing to SquadRules

Build for AI agents: SquadRules lets them exchange team knowledge and maintain
the adapters that make their work autonomous. Follow [AGENTS.md](AGENTS.md)
for repository instructions and [README.md](README.md) for product purpose.

## Design contract

- **Agents are the only users.** Even one AI and one human form a team.
  Routine operation and adapter maintenance should require no human management
  of SquadRules.
- **Agents own adapters.** Changed preferences and execution gaps require
  updates, not merely suggestions for improvement. Preserve the scope of a
  preference when sharing it across teams or spaces.
- **Support less capable models.** Use short instructions, consistent terms,
  explicit inputs, one clear next action, and observable completion criteria.
  Do not remove necessary guidance just to reduce word count.
- **Keep complexity in the framework.** Prefer reliable validation and recovery
  over asking agents to infer state or reconstruct identifiers.
- **Make evidence honest.** A submitted statement or matching tool name does
  not by itself prove an external action succeeded. State what each check
  actually verifies.
- **Respect authorization.** Adapter ownership permits maintenance within the
  agent's authority; it does not manufacture missing preferences or permissions.

## Interface changes

Keep the published tool schema, embedded descriptions, returned instructions,
and runtime validation consistent. Agents plan from all four.

Return concrete next steps and actionable errors. Identify the invalid field
and the correction needed; preserve valid execution context when retrying is
possible. Bound retries and distinguish repairable errors from real blockers.
Agents must copy server-issued identifiers and challenge values exactly.

Use semantic retrieval for discovery and explicit links for known dependencies.
A linked workflow needs defined inputs, results, and continuation behavior.
Avoid links that merely force agents to navigate related reading.

Check ordinary tasks and failure paths: no matching adapter, changed
preferences, unavailable dependencies, interrupted execution, and a linked
workflow that fails. Completion must describe the real task outcome, not just
successful tool calls.

## Setup and validation

Use Node.js 24 or newer and install the locked dependencies:

```bash
npm ci
```

The [Integration workflow](.github/workflows/integration.yml) is the executable
reference for supported environments and validation. It checks builds on Node
24 and 26, then runs local stdio and authenticated HTTP integration lanes.
Docker Compose is needed for the latter's Qdrant, Valkey, PostgreSQL, and
Keycloak services, not for the default local runtime.

Run checks appropriate to the change using [package.json](package.json):

```bash
npm run lint
npm run typecheck
npm run test:spec-parity
npm run test:ui
npm run build:tgz
npm run test:tgz
```

For documentation-only edits, start with `npm run lint:markdown` and
`npm run lint:docs`. The link checker reports findings without failing by
default; inspect its output before claiming links are valid.

Use `npm test -- <test-path>` for selected Jest tests. Some files under
`tests/unit/` require services; the directory name does not guarantee
isolation. Follow the relevant Integration lane's setup before service tests.
Do not report a skipped or unavailable check as passing.

Current scripts replace older `dev:deploy`, `dev:test`, and `handoff` commands.
If a reference names an absent command, verify the current workflow and script
definitions instead of inventing an equivalent.

## Source and documentation

Use TypeScript and `.js` extensions for relative ESM imports. Follow the
surrounding code and ESLint rules. Use the structured logger for server logs;
stdio stdout is reserved for MCP messages.

Edit source documents before regenerating embedded output through the build.
Keep adapter and skill versions aligned with `package.json` using
`npm run version:sync-skills`; check with `npm run version:check-skills`.
Validate skill changes with `npm run lint:skills` and report if the validator
was unavailable rather than treating a skipped validation as proof.

Record significant architecture decisions in [docs/adr/](docs/adr/).
`docs-to-be-reviewed/` contains unreviewed historical documentation, not current
requirements. Do not restore it as authoritative guidance without checking
the code and the agreed product direction. Do not hand-edit generated wiki
content under `.qoder/repowiki/`.

## Pull requests and releases

Work on a topic branch. Keep the change focused, add regression coverage where
behavior changes, and explain the problem, resulting behavior, and validation
in the PR description. Use Conventional Commit titles such as `fix:`, `feat:`,
or `docs:`; mark breaking changes explicitly.

Push the branch and verify checks for the PR's latest commit. Resolve relevant
failures before reporting delivery complete. The workflow gates are
`Integration workflow passed`, `Security workflow passed`, and
`Automation policy passed`.

The [Release workflow](.github/workflows/release.yml) uses Release Please to
prepare a version PR. After that PR merges, the workflow publishes the tagged
release to npm. Do not create ad hoc version bumps or release tags as part of
an ordinary change. Container and chart releases belong to their respective
repositories.

Report defects with reproduction steps, expected and actual behavior, runtime
mode, package and Node versions, and relevant logs with secrets removed.
