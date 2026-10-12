# ADR 0012: Keep redirect tombstones for deeply-referenced renamed slugs

## Status

Accepted — refines [ADR 0010](0010-critic-loop-and-proof-splitting.md); supersedes
its "no compatibility alias" decision for slugs that are deeply referenced.

## Context

ADR 0010 renamed `phase-critic` to `critic-loop` and shipped it as a clean,
non-breaking refactor with **no** alias, on the reasoning that the project has a
single consumer who would re-point the stored adapters. In practice the retired
slug was deeply referenced: the stored Personal-space `git-commit-protocol` and
`git-pr-protocol` both `forward` to `squadrules://adapter/phase-critic`, and that
app-space adapter was then deleted from the live store, so those forwards dangle.
A clean break leaves every not-yet-re-pointed reference silently broken, and a
deleted slug gives the agent no signal about where the behaviour moved.

## Decision

When renaming a **deeply-referenced** app-space adapter slug, keep a thin
**redirect tombstone** under the retired slug rather than removing it outright:

- The tombstone is a minimal valid adapter (one contract layer) whose body states
  the rename and whose contract sends the caller to the replacement:
  `phase-critic` forwards to `squadrules://adapter/critic-loop`;
  `phase-critic-guide` points at `squadrules://adapter/critic-loop-guide`.
- Tombstones live in `src/embed-docs/mem/` like any bundled adapter, so
  boot-injection places them in the app space and they resolve for every consumer
  on the next version bump ([ADR 0002](0002-boot-injection-reuse-rule.md)).
- The replacement adapter stays the single home for real behaviour; the tombstone
  carries no logic, only the redirect.

This supersedes ADR 0010's "no alias" choice **only** for slugs with live stored
referents. A clean break remains the default for a slug nothing forwards to.

## Consequences

### Positive

- Stored adapters that still forward to the retired slug resolve and are
  redirected instead of dangling.
- The rename is discoverable: activating the old slug explains the new one.

### Negative

- Two slugs coexist (retired tombstone plus replacement) — the cost ADR 0010
  wanted to avoid. Bounded: the tombstone is inert and points one way.
- A tombstone adds one hop to a chain; callers should re-point directly to the
  replacement when convenient (the owner's stored git adapters remain to be
  re-pointed to `critic-loop`).

## Alternatives Considered

### Clean break, no tombstone

ADR 0010's original choice. Rejected for `phase-critic` because stored adapters
forward to it, so a clean break silently breaks them and offers no redirect.

### Server-side alias table or slug-migration tool

A general alias/migration mechanism. Rejected for now: a per-slug tombstone
adapter is simpler and ships through the existing boot-injection path with no new
runtime surface. Reconsider if many slugs need redirecting at once.

## Evidence

- `src/embed-docs/mem/phase-critic.md` and `src/embed-docs/mem/phase-critic-guide.md`
  added as one-layer redirect tombstones; `embedded-mcp-resources.ts` regenerated.
- `tests/integration/readonly/squadrules-mem-boot-injection.test.ts` extended to
  assert both retired slugs stay exportable after boot injection.
- Gates: `npm run lint`, `npm run typecheck`, `npm run knip`, and
  `version:check-skills` exit 0.

## Revisit condition

Reopen if tombstones accumulate (many retired slugs) so a general alias or
migration mechanism beats per-slug tombstones, or once every stored referent of
`phase-critic` is confirmed re-pointed and the tombstone can itself be retired.

## Related

- [ADR 0010](0010-critic-loop-and-proof-splitting.md) — the rename this refines.
- [ADR 0002](0002-boot-injection-reuse-rule.md) — boot-injection reuse/re-train on a version bump.
