# Security policy

## Supported versions

SquadRules MCP actively supports the latest release. Security fixes are applied
to the versions listed below.


| Version | Supported |
| ------- | --------- |
| 4.x     | Yes       |


## Reporting a vulnerability

Do not open a public issue for security vulnerabilities. Report privately
by emailing the maintainer at [kuba@xpl.pl](mailto:kuba@xpl.pl).

Include:

- A description of the vulnerability
- Steps to reproduce, if applicable
- Potential impact

We aim to respond within 48 hours and coordinate disclosure before any
public announcement.

## Security best practices

When running SquadRules MCP in production:

- Store all secrets in environment variables. Never commit `.env*` files.
- Use HTTPS for all external endpoints.
- Set a strong `SESSION_SECRET` (32 characters minimum) when
`AUTH_ENABLED=true`.
- Restrict network access to Qdrant (port 6333) and Redis (port 6379) to
trusted hosts only.
- Set a Qdrant API key (`QDRANT_API_KEY`) for any Qdrant instance exposed
beyond localhost.
- Secure Redis with a password for any Redis instance exposed beyond
localhost.
- Keep dependencies up to date to receive security patches.
- Ensure the `data/` directory is not publicly accessible.
- When using **AUTH_ENABLED** with a browser session cookie, keep
  **`SESSION_MAX_AGE_SEC`** in line with your IdP’s maximum SSO session for that
  environment (see the Authentication and Security topic in the [project Wiki](https://github.com/SquadRules/mcp/wiki))
  so cookie lifetime does not exceed what the IdP will honour for refresh and
  re-authentication.

## Threat model and incident response

Security operations depend on an up-to-date threat model and repeatable
incident handling procedure.

- Review the [Threat model](docs/security/threat-model.md) before major auth,
  storage, or pipeline changes.
- Use the [Incident response runbook](docs/security/incident-runbook.md) for
  request-level triage, containment, and post-incident actions.

## Release supply-chain controls

The release workflow includes artifact provenance controls for container
deliverables.

- Generate a CycloneDX SBOM for the release container image and attach it (and the npm package SBOM) to the GitHub Release.
- Sign published container images with Cosign keyless signing.
- Trivy container scan (CRITICAL/HIGH) before creating the GitHub Release.
- Keep Renovate vulnerability alerts enabled and prioritize security updates.

## CI security scans

The **Security** workflow (`.github/workflows/security.yml`) runs on PRs, push to
main, and weekly:

- **Dependency review** (PRs only): reports new dependency risk. In the current
  workflow it runs with `continue-on-error`, so it becomes a merge gate only if
  you require that check in branch protection.
- **npm audit**: fails on high/critical vulnerabilities in the dependency tree.
- **CodeQL**: static analysis (SAST) for JavaScript/TypeScript (security-extended
  queries). Results appear under the repo’s Security → Code scanning tab.
- **Base image OS Trivy**: scans the Docker base image layer for CRITICAL/HIGH
  OS-package vulnerabilities.

To **require** these checks before merging and to enable **secret scanning**
(and push protection), see [Code security setup](docs/security/code-security-setup.md).

