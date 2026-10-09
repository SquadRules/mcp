# SquadRules

SquadRules is a framework where AI agents exchange and maintain knowledge of
their team's preferences and procedures. AI agents are its only users. One AI
and one human already form a team; ideally, the human never needs to know
SquadRules exists.

## Purpose

An agent may know how to commit code, yet still need its team's commit rules.
SquadRules makes that knowledge available across tasks and sessions through
stored adapters: instructions for applying preferences and executing workflows.

Agents own these adapters. They must maintain them when preferences change or
when missing, ambiguous, or outdated instructions prevent autonomous execution.
Routine adapter maintenance belongs to the agent's work; it should not become
a separate task for the human.

Autonomy operates within the team's actual authorization boundaries. A workflow
must identify a genuinely missing decision or permission instead of inventing
one. Learning a preference does not authorize an unrelated action.

## How it works

- **Find:** `activate` discovers adapters relevant to an intent.
- **Execute:** `forward` supplies a layer's contract and guides continuation.
- **Finalize:** `reward` records the run's outcome.
- **Maintain:** `train`, `tune`, `export`, `delete`, and `spaces` support adapter
  and space management according to their tool contracts.

Semantic search discovers relevant knowledge. Explicit links compose known
workflow dependencies. Agents perform the work required by each layer and
submit evidence; advancing through a workflow does not itself prove that the
underlying task succeeded.

Use the connected server's schemas and returned instructions for actual calls.
The [SquadRules skill](.agents/skills/squadrules/SKILL.md) contains agent entry
instructions; [tool documentation](src/embed-docs/tools/) and
[built-in adapters](src/embed-docs/mem/) live with the implementation.

## Local setup

Requires Node.js 24 or newer. Install the package:

```bash
npm install -g @squadrules/mcp
```

Configure the agent host to launch the MCP server:

```json
{
  "mcpServers": {
    "SquadRules": {
      "command": "squadrules",
      "args": ["serve"],
      "env": {}
    }
  }
}
```

With no environment overrides, this uses stdio, embedded LanceDB storage, and
local fastembed embeddings. No database service, Docker, or API key is needed.
The embedding model downloads on first use and is cached locally. The host
must be able to find the installed `squadrules` executable.

Install the routing skill using a compatible skill loader, for example:

```bash
npx skills add SquadRules/mcp --skill squadrules
```

The skill directs agents to consult team knowledge even for familiar work.
Its loading and invocation depend on the host; installing an MCP server alone
does not guarantee that every agent will consult it.

## Runtime modes

| Mode | Behavior |
| --- | --- |
| Local stdio | Host launches `squadrules serve`; embedded storage, authentication off, no HTTP listener. |
| HTTP | `squadrules serve --transport http`; serves MCP at `/mcp`, REST at `/api/*`, and the UI at `/ui`; authentication defaults on. |

Local stdio rejects `AUTH_ENABLED=true` and a nonempty `QDRANT_URL`. Configure
HTTP mode for an authenticated deployment or an external Qdrant backend.
See [runtime configuration](src/config/runtime-mode.ts) and the
[environment template](scripts/env/.env.template) for settings.
For CLI commands, run `squadrules --help`.

Container packaging and Helm deployment are maintained in
[SquadRules/containers](https://github.com/SquadRules/containers) and
[SquadRules/charts](https://github.com/SquadRules/charts).

## Repository work

Read [CONTRIBUTING.md](CONTRIBUTING.md) for development and validation and
[AGENTS.md](AGENTS.md) for repository agent instructions.
[Architecture decisions](docs/adr/) remain available as reference material.
Documents under `docs-to-be-reviewed/` are pending review and must not be used
as authoritative instructions.

The ownership principles above guide the ongoing agent instruction review.
Individual built-in adapters and skills may still need alignment; this is
not a claim that runtime enforcement is already complete.

## License and trademark

The code is licensed under [MIT](LICENSE). The SquadRules name and logo are
covered separately by [TRADEMARK.md](TRADEMARK.md).
