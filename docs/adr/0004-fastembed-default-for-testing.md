# 0004 — fastembed is the default embedding provider for CI test lanes

Status: Accepted, implemented 2026-10-06
Date: 2026-10-06

## Context

Adapter writes were the main OpenAI consumer in CI: boot injection trains the shipped
mem adapters on every server start, and the suites train fixtures too. The previous
cost strategy was to *gate* that spend — `3c76573c` consolidated the integration
workflows "and gate for OpenAI quota" — which made quota a scheduling problem instead
of removing it.

Local embeddings (`fastembed`, CPU ONNX, no key) exist precisely to remove that spend,
and one advisory lane already ran on them.

## Decision

Gated CI test lanes embed locally and hold no OpenAI key:

- `verify-integration-primary` (AUTH) and `verify-integration-simple-smoke` pin
  `EMBEDDING_PROVIDER=fastembed` and blank `OPENAI_API_KEY` in the generated `.env`.
  The `.env` generator requires every `SECRET_KEYS` value to be non-empty, so a
  throwaway placeholder is passed only so generation passes, then stripped.
- Model weights are cached at the default per-user path
  (`~/.config/squadrules/models`), keyed on `hashFiles('src/config/embedding-fastembed.ts')`
  — the module that pins `FASTEMBED_MODEL` — so changing the model invalidates the cache.
- `verify-integration-embedded-simple` already ran key-free and is unchanged.
- `verify-integration-stdio-smoke` is the **exception** and still uses the key. Boot
  injection is awaited before the transport connects, and every stdio test spawns its
  own server, so local ONNX costs minutes per spawn while the launch smoke test aborts
  the MCP handshake at 20 s. Tracked as [#25](https://github.com/SquadRules/mcp/issues/25).
- `scripts/env/.env.template` keeps `EMBEDDING_PROVIDER=openai`. This decision is about
  CI test lanes, not about the quality defaults for self-hosted deployments.

## Consequences

- Gated CI no longer spends OpenAI quota on writes, so quota exhaustion can no longer
  redden a merge gate, and fork PRs need no secret for two of three service lanes.
- Boot is minutes instead of seconds, so both lanes' `HEALTH_CHECK_ATTEMPTS` went from
  15 (~30 s) to 120. The wait loop breaks on the first healthy response, so the cap
  costs nothing when boot is fast — but a lane that kept 15 attempts would have failed
  on a cold runner.
- The OpenAI provider path loses nearly all automated coverage; a minimal 1–2 read
  advisory check is required so a broken provider or dead key is not discovered by
  users. Tracked as [#23](https://github.com/SquadRules/mcp/issues/23).
- No test asserted the OpenAI dimension, so nothing needed re-dimensioning: the only
  `1536` references are a JSDoc example and a unit test that constructs its own fake.
- The provider-selection unit test is env-isolated (it deletes and restores
  `EMBEDDING_PROVIDER` / `OPENAI_API_KEY`), so pinning fastembed in `.env` does not
  change its outcome.

## Alternatives considered

- Keep gating on quota (the `3c76573c` posture): rejected — it preserves an external
  dependency and a spend to avoid a problem that local embeddings already solve.
- Make every lane key-free immediately: rejected for stdio only, for the measured
  reason above, not for cost.

## Evidence

`.github/workflows/integration.yml` (the "Force key-free fastembed embeddings" steps and
the stdio exception comment), `.github/workflows/README.md` (lane matrix wording),
`src/config/embedding-fastembed.ts`, `src/utils/squadrules-user-dirs.ts` (default
models path), `scripts/deploy-generate-dev-secrets.py` (`SECRET_KEYS` non-empty check).
