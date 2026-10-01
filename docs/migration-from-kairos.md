# Migration from KAIROS

This project was formerly named **KAIROS**. It is now **SquadRules** — an
agent-facing persistent protocol system that bridges generic model competence
and your actual local procedure. Even an agent that already knows Git must
consult local rules before acting on "Create PR." MCP is the interface
SquadRules speaks, not the whole identity.

The rebrand ships in a single release with compatibility built in. You do not
need an intermediate "compatibility-only" upgrade, and existing stored data is
preserved. This page maps every old name to its new name, explains what keeps
working unchanged, and lists the concrete steps for operators plus rollback.

## Old-to-new name map

| Surface | Former (KAIROS) | Current (SquadRules) | Old name still works? |
|---------|-----------------|----------------------|-----------------------|
| npm package | `@jakub-plichcinski/kairos-mcp` | `@squadrules/mcp` | Installable, but no longer the primary distribution |
| CLI command | `kairos`, `kairos-mcp` | `squadrules`, `squadrules-mcp` | Yes — all four bin names ship |
| Container (canonical) | `quay.io/jakubplichcinski/kairos-mcp` | `quay.io/squadrules/mcp` | No — update image references |
| Container (mirror) | `docker.io/jakubplichcinski/kairos-mcp` | `docker.io/squadrules/mcp` | No — update image references |
| Helm chart | `kairos-mcp` (`oci://quay.io/<namespace>/kairos-mcp-chart`) | `mcp` (`oci://ghcr.io/squadrules/charts/mcp`) | See [Helm](#helm-deployments) |
| Repository | `jakub-plichcinski/kairos-mcp` | `SquadRules/mcp` | GitHub keeps redirects after transfer |
| MCP server name | `KAIROS` | `SquadRules` | Update your `mcp.json` server key |
| Server env vars | `KAIROS_*` | `SQUADRULES_*` (preferred) | Yes — aliased, with a deprecation notice |
| CLI config dir | `~/.config/kairos` | `~/.config/squadrules` | Yes — legacy fallback, copied forward |
| Keyring service | `kairos-cli` | `squadrules-cli` | Yes — legacy read fallback |
| URI scheme | `kairos://` | `squadrules://` accepted on input | `kairos://` stays the canonical emitted form |

## What keeps working

The compatibility surfaces below are intentional. Nothing here requires action
during the rollback window.

- **CLI binaries.** The package ships four bin entries — `squadrules`,
  `squadrules-mcp`, `kairos`, and `kairos-mcp` — all pointing at the same CLI.
  Existing scripts and `npx` invocations that call `kairos` keep working.
- **Server environment variables.** Every server-side `KAIROS_*` variable has a
  `SQUADRULES_*` alias. See [Environment variables](#environment-variables).
- **`kairos://` URIs.** Both `kairos://` and `squadrules://` are accepted on
  input. See [URI scheme](#uri-scheme).
- **Config directory and keyring.** The legacy `~/.config/kairos` directory and
  `kairos-cli` keyring service are read as fallbacks and copied forward, never
  deleted. See [Config directory and keyring](#config-directory-and-keyring).
- **Stored data.** Deterministic UUID namespaces, protected space IDs, Qdrant
  collection names, and Redis key prefixes are unchanged, so existing vectors
  and state resolve exactly as before.

## Environment variables

Server configuration accepts a `SQUADRULES_*` name (preferred) with the
`KAIROS_*` name as a compatibility fallback. Precedence is decided by
*definition*, not truthiness:

1. If `SQUADRULES_X` is defined — even as an empty string `''` — it wins.
2. Otherwise, if `KAIROS_X` is defined, its value is used and the key is
   recorded for the deprecation notice.
3. Otherwise the built-in default applies.

Empty-string handling preserves the original parsing exactly: for string values
the resolved value still falls through to the default when empty (`resolved ||
default`), so setting `SQUADRULES_X=''` intentionally shadows `KAIROS_X` while
still resolving to the default.

When any `KAIROS_*` variable supplies a value, the process writes a single
consolidated deprecation notice to **stderr** (never stdout, so it cannot
corrupt the stdio MCP JSON-RPC channel), at most once per process, listing each
used key and its `SQUADRULES_*` equivalent.

The full aliased set is defined in [`src/config.ts`](../src/config.ts) and
includes, for example, `KAIROS_KEY_VALUE_PREFIX`, `KAIROS_REDIS_PREFIX`,
`KAIROS_LOCAL_ARTIFACT_DIRS`, the `KAIROS_SEARCH_*` family,
`KAIROS_OIDC_SCOPES_SUPPORTED`, `KAIROS_APP_SPACE_ID`, and
`KAIROS_SIMPLE_PERSONAL_*`.

### CLI-only variables (no alias yet)

A few connection variables are read directly by the CLI and dev/test scripts and
currently use the `KAIROS_*` prefix **only**. Keep using these exact names:

- `KAIROS_API_URL`
- `KAIROS_TIMEOUT_MS`
- `KAIROS_RETRIES`
- `KAIROS_LOGIN_CALLBACK_PORT`
- `KAIROS_NO_BROWSER`
- `KAIROS_CLI_MAX_MARKDOWN_BYTES`
- `KAIROS_EXPORT_ZIP_MAX_DOWNLOAD_BYTES`
- `KAIROS_REVIEW_EVIDENCE`
- `KAIROS_BASE_URL` (used by dev/test scripts under `scripts/`)

Do not rename these to `SQUADRULES_*` — no alias exists for them yet.

## Config directory and keyring

- **Config directory.** The preferred directory is now `squadrules`
  (`~/.config/squadrules` on Unix, `%APPDATA%\squadrules` on Windows, respecting
  `XDG_CONFIG_HOME`). The legacy `kairos` directory is used as a fallback when
  the new directory is missing or empty. A one-time migration copies (never
  moves) the legacy contents into the new directory and writes a
  `.migrated-from` marker. The copy never overwrites newer configuration, never
  selects an empty new directory over valid legacy settings, and never deletes
  the legacy directory. If the copy fails partway, the partial new directory is
  removed and the legacy directory continues to be used.
- **Keyring.** Credentials are read from the new `squadrules-cli` service first,
  then the legacy `kairos-cli` service. On a successful legacy read the
  credential is copied to the new service and verified. Legacy `kairos-cli`
  entries are retained during the rollback window.

## URI scheme

Both `kairos://` and `squadrules://` are accepted wherever an adapter, layer, or
artifact URI is parsed on input. However, all build/emit functions still produce
`kairos://` as the canonical stored form, because persisted Qdrant data uses
`kairos://` URIs. This is an intentional, permanent decision for this migration:
you may pass `squadrules://` URIs in, but the server will continue to emit and
store `kairos://`.

## What operators should do

1. Update container image references to `quay.io/squadrules/mcp` (or the
   `docker.io/squadrules/mcp` mirror) in Compose files, Kubernetes manifests, and
   CI.
2. Update install and CI commands to the new package:
   `npm install -g @squadrules/mcp` and `npx @squadrules/mcp` (or
   `npm exec --package=@squadrules/mcp -- squadrules`).
3. Update your MCP client configuration (`mcp.json`) so the server key and
   command use `SquadRules` / `squadrules`.
4. Optionally rename server env vars from `KAIROS_*` to `SQUADRULES_*` to silence
   the deprecation notice. Leave the CLI-only variables above unchanged.
5. Review any pinned digests or tags and bump them to the rebranded release.

### Helm deployments

The published chart is `oci://ghcr.io/squadrules/charts/mcp`, sourced from the
`SquadRules/charts` repository.

During the transition the in-repo chart directory remains `helm/kairos-mcp`, and
the documented example release name and namespace remain `kairos` (with the
embedding secret `kairos-mcp-embedding`). This is deliberate: keeping the same
release identity preserves existing resource names, selectors, Service targets,
Secrets, and PVC bindings across an upgrade. **Do not rename an existing release
during an upgrade** — immutable selectors would break it. If you use custom
names, review your `values.yaml` before upgrading and prefer an in-place upgrade
with the same release identity over uninstall/reinstall.

## Rollback

Legacy names remain functional, so rolling back is safe:

- Reinstall the previous version — for example
  `npm install -g @jakub-plichcinski/kairos-mcp@<version>` or the prior image
  tag — and the `kairos` / `kairos-mcp` bins, `KAIROS_*` env vars, `kairos://`
  URIs, `kairos` config directory, and `kairos-cli` keyring all continue to work.
- The config-directory copy never deletes `~/.config/kairos`, and `kairos-cli`
  keyring entries are retained, so a downgrade finds the original configuration
  and credentials in place.
- If you renamed server env vars to `SQUADRULES_*`, revert them to `KAIROS_*` or
  keep both — the precedence rules above resolve either case.

## Intentional legacy names

The following keep their `kairos` naming on purpose. Changing them would change
stored meaning or break compatibility, so they are out of scope for the rebrand:

- `kairos://` as the canonical emitted/stored URI scheme.
- Keycloak defaults: realm `kairos`, dev realm `kairos-dev`, clients
  `kairos-mcp` and `kairos-cli`, simple-mode realm `kairos-simple`, and the
  default OIDC scope `kairos-groups`.
- Data-bearing defaults: Qdrant collection `kairos`, app space `space:kairos-app`,
  Redis key prefixes, and deterministic UUID namespaces / protected space IDs.
- In-repo Helm chart directory `helm/kairos-mcp`, example release/namespace
  `kairos`, and embedding secret `kairos-mcp-embedding`.
- Compose project name `-p kairos-mcp`.
- The CLI-only `KAIROS_*` variables listed above.
- The logo asset filename `logo/kairos-mcp.svg` (imported by that exact path in
  `src/ui/`; renaming it is a coordinated follow-up that must update the `src/`
  imports together).
- Internal TypeScript symbols and source filenames (for example `KairosError`,
  `src/tools/kairos-uri.ts`). Cosmetic renames are outside this migration.

## Related links

- [README](../README.md) — install and quick start.
- [CLI reference](CLI.md) — `squadrules` commands and env-var naming.
- [Installation guides](install/README.md) — npm, Docker Compose, and Helm.
- [Implementation issue #835](https://github.com/SquadRules/mcp/issues/835) —
  rebrand and repository-split plan.
