# ADR 0036: Agents do not automatically file upstream GitHub issues on application-flow friction

## Status

Rejected — decision taken 2026-10-31. The proposal was to have the routing skill
(`.agents/skills/squadrules/`) or a bundled adapter automatically open GitHub issues
in `SquadRules/mcp` whenever an agent hit an application-flow problem (a broken
verification step, or a bundled doc/description that was unclear), while excluding
personal/team adapter gaps (which agents repair autonomously). We record the
rejection so the idea is not re-litigated from scratch, and so the conditions that
would justify revisiting it are explicit.

## Context

Two goals motivated the proposal:

1. Surface **real application-flow bugs** that agents currently work around silently.
2. Surface **bundled docs/descriptions that need clarification**, so maintainers learn
   where agents get confused.

The signal is real. Agents that hit flow friction today tend to improvise a workaround
rather than report it — the artifact-materialization byte-mismatch loop tracked in
[#231](https://github.com/SquadRules/mcp/issues/231) is an example where an agent
retried repeatedly and then proceeded without a verified result instead of capturing
the friction.

A capture mechanism already exists: the skill ships a user-triggered structured
failure-capture reference at `.agents/skills/squadrules/references/bug-report.md`. It
produces a raw-JSON-trace report with mandatory fault attribution (**agent error /
server error / unclear**) and saves it locally under `reports/`. It does **not** file
anything upstream and is invoked only when a user asks.

The proposed change was to make capture **automatic** and to **file upstream**, gated
on human permission. The classification boundary the proposal drew is doctrinally
sound and is retained here as guidance even though the filing mechanism is rejected:

- A **personal/team adapter gap** is within the agent's authority to repair, so the
  agent fixes it autonomously (`train`/`tune`) and never reports it upstream.
- A **bundled application-flow defect or unclear bundled doc** is not repairable in
  place by an end-user agent — it ships with the next release — so it is genuine
  upstream signal. (An agent working *inside* this repository can and must repair
  bundled docs directly instead of reporting them.)

## Decision

Do **not** add automatic upstream issue-filing to the routing skill or to any bundled
adapter. The single home for application-flow friction remains the existing
user-triggered local capture in `bug-report.md`, which agents may surface to the user
but must not publish automatically.

The proposal is rejected on five grounds:

1. **Fleet-scale flood with no reliable client-side dedup.** Every agent that hits the
   same unclear doc or the same broken step would file independently. A distributed
   fleet cannot dedup against issues it has not fetched, so N agents produce N
   duplicates. The maintainer triage cost would exceed the value of the signal — the
   opposite of "help, not puzzles".
2. **Identity and capability are unresolved.** Filing would go out under each end
   user's personal GitHub token, and most end-user agents have no write access to
   `SquadRules/mcp` at all — so the automatic path fails for the very population whose
   signal is wanted, while the few who can file do so under scattered identities.
3. **Public spam and privacy surface.** Auto-created public issues from arbitrary
   agents are an abuse vector and risk publishing flow data. `bug-report.md` already
   mandates secret redaction precisely because captured traces are sensitive.
4. **Fault attribution cannot be trusted unattended.** The proposal would file on
   "server error or unclear doc", but agents reliably misattribute their own errors to
   the server. `bug-report.md` requires attribution to be reasoned and human-readable
   because it is not dependable enough to gate an automatic public write.
5. **The permission gate contradicts autonomy doctrine.** "Automatic, but with human
   permission" is internally contradictory: a per-issue confirmation is a routine
   `user_input` gate, which [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md)
   and the design principles forbid, and it exposes the framework to the human, which
   the development constitution says should never be necessary. Consent-once-then-
   autonomous mitigates the gate but does not remove grounds 1–4.

## Consequences

### Positive

- No duplicate-flood, no new intake infrastructure, no abuse/privacy surface from
  unattended public writes.
- The existing local capture path is unchanged and remains the single home for
  flow-friction signal (DRY preserved).
- The retained classification rule (repair personal gaps autonomously; report bundled
  flow defects only where the agent cannot repair them in place) is clarified for
  future authors.

### Negative

- Fleet-wide application-flow signal is **not** centrally collected. Maintainers depend
  on users choosing to share a local `bug-report.md` report, so real bugs and unclear
  docs can go unreported.
- The two motivating goals are only partially served: capture exists, automatic
  upstream aggregation does not.

### Neutral

- A human-directed filing (as with
  [#231](https://github.com/SquadRules/mcp/issues/231)) remains fully supported and is
  the intended path when an agent or user does want to report upstream.

## Alternatives considered

- **Bundled `report-flow-issue` adapter + skill trigger + personal overlay.** The
  doctrinally correct *shape* if this were built: trigger policy in the skill routing
  discipline, execution mechanics (dedup search, capability probe, evidence-bound body,
  file-vs-local fallback) in a bundled adapter, and per-team intake preferences in a
  personal/group overlay that forwards to it. Rejected for the five grounds above, not
  for its shape — the shape is recorded so a future revisit does not redesign it.
- **Local-only automatic capture.** Auto-run the `bug-report.md` capture on
  server-error/unclear-doc without filing upstream, leaving harvesting to maintainers.
  Not adopted now because there is no harvest channel, so the reports would accumulate
  locally with no route to maintainers; revisit if a harvest mechanism appears.
- **Single controlled intake channel.** One maintainer-controlled identity or a
  server-side submission endpoint with server-side dedup and rate limiting. This is the
  condition that would make automatic upstream reporting viable; it does not exist yet.

## Evidence

- `.agents/skills/squadrules/references/bug-report.md` — the existing user-triggered
  local capture, its fault-attribution classes, and its redaction mandate.
- `.agents/skills/squadrules/SKILL.md` — the skill is the concise router; workflow
  mechanics belong in adapters, not inline in the skill.
- [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) — `user_input` is an
  emergency valve, not a routine confirmation gate.
- `docs/adapter-design-principles.md` §1 (autonomy) and §2 (help, not puzzles) — the
  principles the flood and permission-gate problems violate.
- [#231](https://github.com/SquadRules/mcp/issues/231) — an example of flow friction an
  agent worked around silently, and of the human-directed filing path that stays open.

## Revisit condition

Reopen when a maintainer-side intake exists that removes grounds 1–3 — specifically a
single controlled submission channel (one bot identity or a server-side endpoint) with
server-side dedup and rate limiting — or when a harvest mechanism makes local-only
automatic capture actionable. Do not rewrite this record; supersede it with a new ADR
that states which intake guarantee changed.

Track in a new issue; do not reopen on the mere desire to collect more signal.

## Related

- [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) — autonomy and the
  prohibition on routine human confirmation gates.
- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the verification ladder a
  hypothetical `report-flow-issue` adapter would have to satisfy.
