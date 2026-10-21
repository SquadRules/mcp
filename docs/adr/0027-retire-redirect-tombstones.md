# ADR 0027: Retire redirect tombstones for renamed slugs

## Status

Accepted — decision taken 2026-10-21 and implemented by the accompanying change;
not yet on `main` when this record was written. Supersedes
[ADR 0012](0012-redirect-tombstones-for-renamed-slugs.md).

## Context

[ADR 0012](0012-redirect-tombstones-for-renamed-slugs.md) added a **redirect
tombstone**: a minimal one-layer adapter left behind under a retired slug so a
stored adapter that still forwards to it resolves and is redirected instead of
dangling. It was a deliberate exception to
[ADR 0010](0010-critic-loop-and-proof-splitting.md)'s clean-break rename, granted
because the retired slug was believed to be deeply referenced. Three shipped:

| File | Slug | Redirects to | Lines |
| --- | --- | --- | --- |
| `src/embed-docs/mem/phase-critic.md` | `phase-critic` | `critic-loop` | 46 |
| `src/embed-docs/mem/phase-critic-guide.md` | `phase-critic-guide` | `critic-loop-guide` | 42 |
| `src/embed-docs/mem/create-new-protocol.md` | `create-new-protocol` | `author-adapter` | 44 |

ADR 0012 named its own exit: *"once every stored referent of `phase-critic` is
confirmed re-pointed and the tombstone can itself be retired."* **That condition is
met.** ADR 0012's own Context already recorded that the app-space adapter holding
the forwards *"was since deleted from the live store, so those forwards dangle"* —
the referent was gone at the moment the tombstone was written. And SquadRules/mcp
has **no live instances**: local, scrappable stores only, no deployed consumer, no
external integration. There is nothing left to redirect.

What remains is cost, and it is not trivial:

- **132 lines of inert markdown** are boot-injected into every store on every
  version bump ([ADR 0002](0002-boot-injection-reuse-rule.md)), embedded, and
  re-embedded. Three of the twelve bundled adapters — a quarter of the bundle —
  carry no behaviour at all.
- **A runtime filter exists purely to hide them.** `src/tools/search_output.ts`
  skips any result whose slug satisfies `isRedirectTombstone`, because a tombstone
  that surfaced as a match choice would send an agent to a stub. The mechanism
  needs a suppression layer to avoid degrading the thing it protects.
- **Two mechanisms do one job.** The tombstone files resolve a retired slug by
  forwarding; `resolveAdapterSlugAlias` in `src/utils/adapter-alias.ts` resolves
  `create-new-protocol` → `author-adapter` in code at retrieval and read time
  (`src/services/qdrant/memory-retrieval.ts`,
  `src/services/vector-store/lancedb/lance-records-reads.ts`). The same slug is
  redirected twice by two different layers, and the two are not even coextensive —
  the alias covers one slug, the tombstones cover three.
- **The bundle teaches its own dead weight.** `src/embed-docs/mem/README.md`
  carries a "Redirect tombstones" section; `author-adapter.md:22` explains that its
  own retired slug "is a redirect tombstone (see phase-critic pattern)". The
  bundled adapters are supposed to be elite examples
  ([ADR 0024](0024-adapter-contract-verification-ladder.md)), and these teach a
  migration pattern that this record retires.
- **Three retired slugs stay announced in the authoritative tool contracts.**
  `src/embed-docs/tools/forward.md:12` ("stored as `create-new-protocol`; both
  slugs resolve to the same stored adapter") and
  `src/embed-docs/tools/activate.md:97` ("The original `create-new-protocol` name
  continues to resolve") both promise behaviour this record removes.

## Decision

Remove the redirect tombstone mechanism. A retired slug is simply gone; a clean
break is the only path, which restores
[ADR 0010](0010-critic-loop-and-proof-splitting.md)'s original choice.

1. **Delete the three tombstone adapter files** from `src/embed-docs/mem/`:
   `phase-critic.md`, `phase-critic-guide.md`, `create-new-protocol.md`. Regenerate
   `src/resources/embedded-mcp-resources.ts` and the slug metadata.
2. **Remove the tombstone code** from `src/utils/adapter-alias.ts`:
   `REDIRECT_TOMBSTONE_SLUGS`, `isRedirectTombstone`, `resolveAdapterSlugAlias`,
   and `RETIRED_AUTHORING_ADAPTER_SLUG`. Remove the suppression filter and its
   comment from `src/tools/search_output.ts`.
3. **Keep what is not alias code.** `AUTHORING_ADAPTER_SLUG` and
   `isAuthoringAdapterSlug` stay — they name the canonical authoring slug and gate
   the authoring-context rules in `src/tools/forward.ts`
   ([ADR 0016](0016-explicit-adapter-authoring-context.md)). `isAuthoringAdapterSlug`
   becomes a direct comparison now that no alias resolves into it.
4. **Delete `tests/unit/redirect-tombstone-filter.test.ts`** — it asserts
   `REDIRECT_TOMBSTONE_SLUGS.size === 3` and its exact membership, so it tests only
   the removed mechanism. Update `tests/unit/authoring-routing.test.ts`, which
   currently asserts `create-new-protocol` routes to `author-adapter` in two
   places.
5. **Update the boot-injection integration test.**
   `tests/integration/readonly/squadrules-mem-boot-injection.test.ts` lists
   `phase-critic` and `phase-critic-guide` in `STATIC_SYSTEM_ADAPTERS` and asserts
   each is exportable by slug URI; both entries go (7 → 5). Its
   `EXPECTED_BOOT_ADAPTER_COUNT` is a `toBeGreaterThanOrEqual` floor of 6 against
   the 12 injected `mem/` adapters, so it still holds at 9 — but it is reviewed in
   the same change, together with the separate `skill-format-guide.md` removal the
   accompanying plan schedules.
6. **Update the docs that announce the alias**: the "Redirect tombstones" section
   in `src/embed-docs/mem/README.md`, the tombstone reference in
   `src/embed-docs/mem/author-adapter.md`, and the retired-slug sentences in
   `src/embed-docs/tools/forward.md` and `src/embed-docs/tools/activate.md`.

This is a breaking change to a surface with no consumers, and it ships without a
major-version bump, a grace window, or a re-announcement — the same reasoning
[ADR 0026](0026-shell-interpreter-required.md) applies to the interpreter field.

## Consequences

### Positive

- The bundle shrinks by 132 lines and three adapters that modelled nothing. A
  quarter of the boot-injected set stops being inert.
- One mechanism instead of two: no code-level alias layered under file-level
  tombstones, and no suppression filter hiding stubs from search results.
- The authoritative tool contracts stop promising resolution for slugs that do not
  exist, which removes a false lead for an agent reading `forward.md` or
  `activate.md`.
- `knip` reclaims the dead exports; the shipped adapters become a cleaner set of
  examples for [ADR 0024](0024-adapter-contract-verification-ladder.md) compliance.

### Negative

- A stored adapter that forwards to any of the three retired slugs now dangles
  with no redirect and no explanation. Accepted: ADR 0012 already recorded the
  known referent as deleted from the live store, and the project has no live
  instances. If one ever surfaces, the fix is re-pointing the forward — a one-line
  `tune` — not reinstating a mechanism.
- [ADR 0017](0017-critic-loop-work-submission.md) §3 justified keeping
  `input_file` as an accepted alias by citing "the same reasoning that keeps
  redirect tombstones in ADR 0012", and its Evidence records an exported
  user-space adapter whose `Phase-Critic Review` layer forwards to the
  `phase-critic` tombstone slug. **That cross-reference is now stale.** ADR 0017's
  decision is not disturbed by this record — it rests on its own observation of an
  external caller passing `input_file`, which is a contract *field* alias, not a
  slug tombstone — and per ADR doctrine its accepted body is not rewritten here.
  Whether that external caller still exists is ADR 0017's own revisit question.
- [ADR 0016](0016-explicit-adapter-authoring-context.md)'s Decision states that
  the old `create-new-protocol` slug "becomes a one-layer redirect tombstone".
  This record removes that tombstone. ADR 0016's substantive decision — the rename
  to `author-adapter` and the explicit authoring context — is unaffected and stays
  Accepted; only its tombstone clause is superseded, and its body is left
  untouched.
- If tombstones are ever needed again, they must be re-derived from scratch. That
  is the point: the mechanism should be built when a referent exists, not carried
  in case one appears.

## Alternatives Considered

### Keep the tombstones because they are cheap

Rejected. They are not cheap: 132 boot-injected lines, a search-result suppression
filter, a second alias mechanism in code, four documentation sites announcing
retired slugs, and two test files asserting the mechanism exists. All of it is
spent protecting referents that ADR 0012's own Context recorded as already deleted.

### Replace the per-slug tombstones with a general alias table

The alternative ADR 0012 deferred ("reconsider if many slugs need redirecting at
once"). Rejected, and more strongly now: a general mechanism is a larger surface
built for the same empty set. Three slugs over two rename events did not reach the
threshold that justified even the per-slug form.

### Keep the code alias, delete only the tombstone files

Rejected. It preserves the duplication this record removes — the same slug
resolved by two layers — and keeps `create-new-protocol` alive in
`memory-retrieval.ts` and `lance-records-reads.ts` for no referent. A clean break
means the slug is gone everywhere, not gone in files and alive in code.

### Retire only `phase-critic` and `phase-critic-guide`, keep `create-new-protocol`

Rejected. The three share one justification and one exit condition. Keeping the
newest tombstone because its rename is more recent would make age the criterion,
and ADR 0016's authoring-context work is landed and tested against the canonical
`author-adapter` slug.

## Evidence

- `src/utils/adapter-alias.ts` — the whole file: `REDIRECT_TOMBSTONE_SLUGS` with
  three members, `isRedirectTombstone`, `resolveAdapterSlugAlias` (handles only
  `create-new-protocol`), `RETIRED_AUTHORING_ADAPTER_SLUG`, plus
  `AUTHORING_ADAPTER_SLUG` / `isAuthoringAdapterSlug` which survive.
- `src/tools/search_output.ts:135-138` — the suppression filter and its
  `(ADR 0012)` comment.
- `src/services/qdrant/memory-retrieval.ts:1` and
  `src/services/vector-store/lancedb/lance-records-reads.ts:1` — the code-level
  alias applied at read time.
- `src/embed-docs/mem/phase-critic.md`, `phase-critic-guide.md`,
  `create-new-protocol.md` — 46 / 42 / 44 lines, all stamped `version: "5.11.0"`,
  each a single `mcp` or `comment` contract forwarding to the replacement.
- `src/embed-docs/mem/README.md:52-61` — the "Redirect tombstones" section.
- `src/embed-docs/mem/author-adapter.md:22`,
  `src/embed-docs/tools/forward.md:12`, `src/embed-docs/tools/activate.md:97` —
  the four doc sites announcing retired-slug resolution.
- `tests/unit/redirect-tombstone-filter.test.ts:30-32` — asserts
  `REDIRECT_TOMBSTONE_SLUGS.size` is 3 and its exact membership.
- `tests/unit/authoring-routing.test.ts:115,163` — asserts `create-new-protocol`
  starts and resolves to the same adapter as `author-adapter`.
- `tests/integration/readonly/squadrules-mem-boot-injection.test.ts:13,20-21` —
  `EXPECTED_BOOT_ADAPTER_COUNT = 6` (a `>=` floor) and the two tombstone slugs in
  `STATIC_SYSTEM_ADAPTERS`.
- [ADR 0012](0012-redirect-tombstones-for-renamed-slugs.md) — Context records the
  live referent as already deleted from the store; Revisit condition names
  retirement once referents are re-pointed.

## Revisit condition

Reopen if a live referent to a retired slug is ever observed again — a deployed
instance, a published integration, or an external consumer's stored adapter whose
forward dangles after a rename. That is the condition ADR 0012 was written for,
and its return would justify rebuilding a redirect mechanism, though not
necessarily this one: with more than a handful of retired slugs the general alias
table ADR 0012 deferred becomes the cheaper form. Track via a new issue; do not
rewrite this record.

## Related

- [ADR 0012](0012-redirect-tombstones-for-renamed-slugs.md) — **superseded** by
  this record. Its revisit condition is met; its body is preserved unchanged.
- [ADR 0010](0010-critic-loop-and-proof-splitting.md) — the clean-break rename
  this record restores as the only path.
- [ADR 0016](0016-explicit-adapter-authoring-context.md) — the
  `create-new-protocol` → `author-adapter` rename whose tombstone clause this
  record removes; the substantive decision stands.
- [ADR 0017](0017-critic-loop-work-submission.md) — §3 cites ADR 0012's reasoning
  for the `input_file` field alias; that cross-reference is now stale, its decision
  is not affected.
- [ADR 0002](0002-boot-injection-reuse-rule.md) — the version bump and re-injection
  the deletions require.
- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the bundled adapters
  must be elite examples; three inert stubs are not.
- [ADR 0026](0026-shell-interpreter-required.md) — the same no-grace-window
  reasoning for a breaking change with no live consumers.
