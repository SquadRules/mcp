# ADR 0035: Bundled system adapters are exempt from the gate-script artifact requirement

## Status

Accepted — decision taken 2026-10-28, clarifies [ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) §2 for the specific case of bundled system adapters shipped in `src/embed-docs/mem/`.

## Context

[ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) §2 states: "A check with more than one condition, JSON parsing, or more than one readable line ships as a gate script artifact attached to the adapter with `train`."

The bundled system adapters under `src/embed-docs/mem/` have multi-condition inline gates (e.g., `bulk-insert-adapters-via-cli.md` chains 5 conditions with `&&`, `critic-loop.md` chains 3 conditions). Per ADR 0033 §2, these should be gate script artifacts.

However, bundled system adapters have no artifact-attachment path in this repository:
- `src/embed-docs/` ships markdown only (no artifact files).
- `artifact_name` reaches the store through the `train` tool, not through boot injection (`src/resources/mem-resources-boot.ts` only trains markdown content).
- Adding artifact support for bundled adapters would require significant new infrastructure (artifact file shipping, boot-time artifact training, adapter references to artifacts).

The bundled adapters are versioned with the repository (frontmatter `version: "5.13.7"`), reviewable in place (they're markdown files in the repo), and tested by the unit suite (`tests/unit/adapter-contract-blocks.test.ts` pins contract counts). The ADR 0033 problem — user-space adapters inlining 2 KB of escaped Python that cannot be reviewed, linted, or tested — does not apply to bundled adapters.

## Decision

Bundled system adapters (shipped in `src/embed-docs/mem/` and injected at boot by `mem-resources-boot.ts`) are exempt from ADR 0033 §2's artifact requirement. Their inline multi-condition gates are permitted because:

1. They are versioned with the repository and update atomically with it.
2. They are reviewable in place (markdown files in the repo, not escaped programs).
3. They are tested by the unit suite (contract-count pins).
4. The artifact-attachment path does not exist for boot-injected adapters, and adding it is not justified for the bundled set.

This exemption does **not** apply to user-space adapters stored in the MCP store. User-authored adapters with multi-condition checks must still ship them as gate script artifacts per ADR 0033.

## Consequences

### Positive

- No new infrastructure needed for bundled adapter artifacts.
- Bundled adapters remain simple markdown files, easy to review and test.
- The ADR 0033 rule stands for user-space adapters, where the readability/reviewability problem is real.

### Negative

- Two classes of adapters (bundled vs user-space) now have different rules for multi-condition gates. Authors must know which class they're writing for.
- If bundled adapters grow in complexity or number, the exemption may need revisiting.

### Neutral

- The gap recorded in [ADR 0034](0034-verification-isolation-critic-hop.md) Consequences → Negative ("bundled adapters have no artifact-attachment path") is closed by this record.

## Evidence

- `src/embed-docs/mem/bulk-insert-adapters-via-cli.md` lines 111, 154 — multi-condition inline gates (5 and 3 conditions).
- `src/embed-docs/mem/critic-loop.md` line 253 — multi-condition inline gate (3 conditions).
- `src/embed-docs/mem/critic-loop-guide.md` lines 103, 118, 245 — teaching examples with multi-condition inline gates.
- `src/resources/mem-resources-boot.ts` — boot injection trains markdown only, no artifact support.
- `src/embed-docs/` directory — ships markdown files only (`find src/embed-docs -type f ! -name '*.md'` returns empty).
- `tests/unit/adapter-contract-blocks.test.ts` — pins contract counts for bundled adapters.

## Revisit condition

Reopen when any of these is observed:

- A bundled adapter's inline gate exceeds ~200 characters or spans multiple logical lines — then the readability cost approaches the ADR 0033 problem, and artifact support for bundled adapters may be justified.
- The boot injection gains artifact support — then the exemption is obsolete and bundled adapters should attach artifacts like user-space adapters.
- The unit suite's contract-count pin is removed or weakened — then the testing guarantee that compensates for the lack of artifact reviewability is lost.

Track in a new issue; do not rewrite this record.

## Related

- [ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) — the gate-script artifact rule this record exempts bundled adapters from.
- [ADR 0034](0034-verification-isolation-critic-hop.md) — recorded the gap this record closes.
