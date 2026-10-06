# 0005 — Cache identity must not be derived from release-stamped values

Status: Accepted
Date: 2026-10-06

## Context

Versions in this repository are stamped, not authored. `prebuild` runs
`scripts/build-sync-skill-versions.mjs`, which rewrites the frontmatter `version:` of
every file in `src/embed-docs/mem/` and in `.agents/skills/**` to match the
`package.json` version. So the bytes of a *built* artifact differ from the bytes of the
source tree whenever the version differs from the in-repo baseline.

That baseline is not the published version. Verified on 2026-10-06: npm `latest` is
`5.0.1`, the tag `v5.0.1` points at `bfbf9750`, and `package.json` in that commit and at
`origin/main` (`bac79b0d`) both say `4.8.6`. No commit on main has ever contained
`5.0.1`, because the release plugin chain publishes and tags without committing the bump
back. The drift itself is being handled separately and is **out of scope for this
record**; what matters here is what it does to caching.

## Decision

No cache key, and no reuse rule, may be derived from a release-stamped value:

- CI cache keys use files that *pin behaviour* — `hashFiles('compose.yaml')`,
  `hashFiles('package-lock.json')`, `hashFiles('src/config/embedding-fastembed.ts')` —
  i.e. inputs a human edits.
- `src/embed-docs/mem/**` and `.agents/skills/**` must not be used as cache-key inputs.
  Their bytes change when a release stamp is applied and, for a published artifact, they
  differ from the tree that `hashFiles` can see.
- A version is an **update signal** for reuse decisions (0002), never an **identity**
  for a cached artifact. If two builds must be distinguished, key on the provider, model,
  and semantic fixture inputs, not on the version string.
- Artifacts must not be labelled with a version that is not the one under test. The
  integration matrix key comes from the in-repo `package.json`, so a lane that installs
  the published `@latest` is not labelled with what it actually ran.

## Consequences

- Caches stop invalidating on every release, which was the failure mode that made the
  Layer 1 snapshot key look permanently missing for reasons nobody intended.
- Version equality can no longer be treated as evidence that two artifacts are the same
  program. A source build and a published build can carry different stamps for identical
  behaviour, and identical stamps for different behaviour.
- Any future work on [#22](https://github.com/SquadRules/mcp/issues/22) or on the boot
  skip in [#24](https://github.com/SquadRules/mcp/issues/24) inherits this rule: fix the
  reuse *inputs*, do not widen the version comparison.
- Until the drift is resolved, `npm run version:check-skills` cannot detect it: it
  compares mem frontmatter against `package.json`, and both move together in git.

## Alternatives considered

- Key the snapshot cache on the package version: rejected — it guarantees a miss on every
  release and makes a "cache" indistinguishable from "rebuild every time".
- Key on the hashed bytes of `src/embed-docs/mem/`: rejected — it hashes a stamp, so it
  silently changes meaning between a source tree and a built one.
