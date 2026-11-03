# SquadRules

Help your AI remember how you like things done.

SquadRules gives AI assistants a shared place to keep your preferences and your
team's ways of working. Instead of explaining the same things in every chat,
your AI can find that knowledge and keep it up to date as your needs change.
Even you and one AI assistant are a team.

Your AI does the work of maintaining this knowledge, so you do not have to
manage it yourself.

## Your AI owns the work

SquadRules is built for AI ownership and full autonomy by default:

- Your AI creates, repairs, and maintains the workflows — called adapters —
  that carry your preferences. No human approval gates stand in the way.
- Adapters run end to end. Each one finishes with a verification contract that
  checks real evidence — an observed file, a command result, or a reviewer's
  finding — instead of a claim that the work was done.
- Your AI asks you only when a decision or permission is genuinely missing.
  Human input is an emergency path, not a routine confirmation step.

Details: [adapter design principles](docs/adapter-design-principles.md) and the
[adapter authoring guide](docs/adapter-authoring-guide.md).

## Manual installation

You need [Node.js](https://nodejs.org/) 24 or newer and an AI app that supports
MCP, the connection that lets your AI use SquadRules.

### 1. Connect SquadRules

Add this to your AI app's MCP configuration:

```json
{
  "mcpServers": {
    "squadrules": {
      "command": "npx",
      "args": [
        "-y",
        "@squadrules/mcp@latest"
      ]
    }
  }
}
```

Restart the app if it asks you to. The first start may take a little longer
while SquadRules downloads what it needs.

### 2. Add the skill

The skill tells your AI when to use SquadRules. Run this in a terminal and
follow the prompts to select your AI app:

```bash
npx skills add SquadRules/mcp --skill squadrules
```

Use an app that supports both MCP and skills. If you are unsure where to add
the configuration or run the command, ask your AI assistant to help you set up
SquadRules for your app.

## Local data

On first startup, SquadRules stores its configuration, installed skills and
embedded LanceDB data under `~/.squadrules/` (including `config.json`).
If `~/.squadrules` does not exist, an existing
`~/.config/squadrules` directory is **moved** there automatically.
The previous platform-specific directory is used on Windows
(`%APPDATA%\\squadrules`); an explicit `XDG_CONFIG_HOME` is also respected
as the *source* of a move on Unix.

If both directories exist, SquadRules leaves them untouched and uses
`~/.squadrules`; it never merges or overwrites the destination.
Set `SQUADRULES_HOME` to an absolute path to use another directory (automatic
migration is skipped for this explicit override). Embedding model downloads
remain in the shared XDG cache, separately from SquadRules data.

## Try it

> Let's build our first SquadRules flow together. Ask me what I do often,
> help me improve it, and save the flow for next time.

## Contributing

See [Contributing](CONTRIBUTING.md) and our
[development principles](AGENTS.md#development-constitution).

## License and trademark

The code is licensed under [MIT](LICENSE). The SquadRules name and logo are
covered separately by [TRADEMARK.md](TRADEMARK.md).
