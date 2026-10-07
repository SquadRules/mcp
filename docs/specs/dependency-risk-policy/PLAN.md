# Revised security recommendation for PR #31

Status: proposal only. Merging this document does not approve exceptions or change CI enforcement.

Research baseline: 7 October 2026, SquadRules/mcp PR #31 head `58603d5afc4aaeb9e4c6247f8a4c90efc6abedef`, reconfirmed unchanged on GitHub.

## Recommendation

**Keep npm, semantic-release, markdownlint-cli2 and Mermaid CLI. Retain PR #31's compatible fixes. Scan all dependencies and apply a reviewed risk policy with narrowly scoped, expiring exceptions.** Do not fork npm, migrate package managers, downgrade working tools or rewrite releases merely to make the raw audit count zero.

The objective is **no unmanaged material security risk**, including development and publishing tools. Known, bounded risk may be accepted temporarily with evidence and accountability. An accepted finding remains a finding; it is not reported as fixed or removed.

This replaces the earlier zero-tolerance proposal. This proposal changes no runtime code, GitHub alert or active ignore policy. The accompanying [risk register](risk-register.draft.json) contains proposed decisions, not approved exceptions.

## Corrections and newly verified evidence

- My earlier suggestion was to replace `markdownlint-cli2@0.23.3` with a different package, `markdownlint-cli@0.49.1`. It was not a downgrade of CLI2. The audit's suggestion to downgrade CLI2 to 0.0.4 should be rejected. Under the revised policy, keep CLI2.
- The exact npm 11.21.0 bundle configures http-cache-semantics through make-fetch-happen with **`shared: false`**. A runtime probe of that wrapper confirms it. My previous reproduction used **`shared: true`**. It demonstrates library behavior under different conditions, not an exploit against npm. Recommending an npm fork on that evidence was excessive.
- Today's repeated full audit reports **16 affected-package entries: 14 high and 2 moderate**. These represent **13 advisory IDs across six underlying packages**, with ten additional entries propagated through parent dependencies.
- The release-it experiment introduced another vulnerable dependency and required additional overrides and release-order changes. A clean audit alone does not justify that migration when the original tool's exposure can be bounded.

Evidence: [current audit](evidence/reassessment/audit-current.json), [npm cache-context probe](evidence/reassessment/cache-context.json), [source excerpts with hashes](evidence/reassessment/SOURCE-REVIEW.md). This proposal supersedes the earlier zero-tolerance migration recommendation.

## Documentation and Mermaid tooling

| Command | What the repository uses it for | Decision |
| --- | --- | --- |
| `lint:markdown` | CLI2 checks `docs/**/*.md`, README, CONTRIBUTING and SECURITY using `.markdownlint.jsonc` | Keep |
| `lint:markdown:fix` | Same Markdown rules, with automatic fixes | Keep |
| `lint:mermaid` | `validate-mermaid.sh` extracts Mermaid fences and renders them using `mmdc`/Puppeteer | Keep and validate |
| `lint:docs` | Documentation link checking | Keep |
| `handoff` | Includes Markdown and Mermaid checks | Preserve both |

Markdownlint checks Markdown structure and fences; it does not validate graph syntax inside a Mermaid fence. That is the separate renderer's job. CLI2 passes filenames as candidates and configured globs as patterns. The braces vulnerability concerns deeply nested **patterns**, not graph text in Markdown. Similarly, semantic-release uses configured branch patterns and release rules; commit messages are candidate data, not the configured patterns.

The build workflow runs `npm run lint`, which includes Markdown and link checks but **does not explicitly invoke `lint:mermaid`**. Add a bounded Mermaid validation step/job, particularly to validate PR #31's KaTeX override. Six documentation files currently contain Mermaid fences. Require discovery and validation of the actual blocks; a run that accidentally finds zero diagrams must not count as evidence.

Before making the renderer check required, verify recursive file coverage and duplicate-basename isolation: the current script uses shell glob expansion and basename-derived temporary paths. Its Puppeteer configuration disables Chromium sandboxing. Prefer working sandbox support; otherwise isolate rendering in an ephemeral job without secrets/write permissions, with a timeout and reviewed network access. These are proposed controls, not claims that the current configuration already enforces them.

Sources: [CLI2](https://github.com/DavidAnson/markdownlint-cli2), [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli).

## Review of every remaining advisory

Local risk below is a **proposed contextual assessment**, not a replacement for upstream CVSS or a declaration of global safety. Check current exploitation intelligence and actual CI controls before approval. Confidence is bounded to inspected call sites. The npm brace-expansion assessment deliberately remains provisional.

| Package / advisory | Upstream severity | Proposed local risk and evidence | Action |
| --- | --- | --- | --- |
| braces 3.0.3 — GHSA-vfj7-8cjw-p6xm | High | **Low, medium confidence.** Observed lint/release patterns are repository-controlled. No public arbitrary-pattern endpoint identified. A PR can change configuration, so untrusted lint execution must remain unprivileged. | Keep tools; 30-day exception after controls verified |
| npm/brace-expansion 5.0.9 — GHSA-q2hr-2g5m-vwhr | Moderate | **Moderate provisional, low confidence.** npm glob/manifest/workspace/pack paths are broader; attacker-input tracing is incomplete. CPU exhaustion remains plausible. | 14-day interim exception; bounded unprivileged jobs; investigate within 3 working days |
| npm/brace-expansion — GHSA-qhr7-859c-m2p7 | High | **Moderate provisional, low confidence.** Nested-group recursion; same broader npm input uncertainty. | Same interim conditions |
| npm/brace-expansion — GHSA-6j4f-fj2g-mc7p | High | **Moderate provisional, low confidence.** Comma-parser recursion; same uncertainty. | Same; not a not-affected claim |
| npm/http-cache-semantics 4.2.0 — GHSA-ch52-4w7c-c8xp | High | **Low, medium confidence.** Exact npm caller uses private-cache semantics; prior reproduction used shared-cache semantics. No npm cross-user exploit established. | 30-day exception; verify cache trust separation; no fork |
| npm/ip-address 10.5.0 — GHSA-rpw4-54j3-4h4q | Moderate | **Low, medium confidence.** No inspected npm consumer uses the affected link-local classifier for access control. | 30-day exception for this route only |
| npm/ip-address — GHSA-2vr4-cq9g-pvrc | Moderate | **Low, medium confidence.** No inspected consumer relies on missing NAT64 classification as a security decision. | Same; new SSRF/allowlist usage invalidates assessment |
| npm/ip-address — GHSA-j6r3-76f7-8jcv | Moderate | **Low, medium confidence.** No external calls to the affected subnet-check methods found in inspected bundle. | Same; do not generalize to other consumers |
| npm/ip-address — GHSA-h3mg-xc3c-68pw | Moderate | **Low, medium confidence.** Inspected socks paths validate strings with `net.isIPv6` or decode fixed 16-byte addresses; arbitrary-length diagnostic input was not identified there. | Same; test those input-guard assumptions |
| npm/postcss-selector-parser 7.1.4 — GHSA-rj75-hqrm-r3gf | Moderate | **Low, medium confidence.** Used by npm query and also npm sbom. Current SBOM selectors are internally generated; no public arbitrary-selector input found. | 30-day exception; retain bounded, reviewed selectors |
| npm/undici 6.28.0 — GHSA-3wwx-pv8p-q78v | Moderate | **Low, medium confidence.** WebSocket decompression flaw; inspected node-gyp caller downloads over HTTP(S), not WebSocket. | 30-day exception for bundled copy only |
| npm/undici — GHSA-rfgv-xxqx-mfg5 | High | **Low, medium confidence.** WebSocket subprotocol flaw; same absent feature usage in inspected caller. | Same |
| npm/undici — GHSA-r53p-7pc4-xj5r | Low | **Low, medium confidence.** node-gyp does use RetryAgent. However, it downloads artifacts rather than forwarding response framing downstream, a prerequisite of the described response-splitting attack. | Same; retain artifact-origin/integrity checks; reassess new forwarding use |

All 13 advisory URLs, installed paths, versions, assumptions and expiry proposals are in [risk-register.draft.json](risk-register.draft.json). The other ten audit entries are `micromatch`, `fast-glob`, `globby`, `markdownlint-cli2`, `semantic-release`, `@semantic-release/commit-analyzer`, `@semantic-release/exec`, `@semantic-release/github`, `@semantic-release/npm` and `@semantic-release/release-notes-generator`. Their propagated root in this audit is the braces advisory. Resolve propagation to the evaluated root instance; do not add ten blanket package exceptions.

The application's undici override does not rewrite npm's bundled copy. This review of project npm 11.21.0 does not automatically cover a different runner/global npm: inventory the executable path/version and match its own bundle evidence.

No live cross-user npm exploit, hostile-proxy integration or end-to-end release exploit test was performed. Individual KEV/active-exploitation/EPSS status has not been verified for these 13 advisories during this reassessment; it is an activation check, not assumed negative evidence. Source searches alone do not prove a package universally unreachable.

## Review of every change already in PR #31

Retain useful fixes, subject to behavior validation where overrides cross compatibility ranges.

| Change | Consumer / significance | Decision and validation |
| --- | --- | --- |
| MCP SDK 1.30.1 → 1.32.1 | Runtime protocol implementation | Keep; typecheck and HTTP/stdio contract tests; consider fixed-version manifest minimum |
| shell-quote 1.10.0 → 1.12.0 | concurrently | Keep; exercise spaces/metacharacters in command arguments |
| KaTeX 0.16.47 → **0.18.10** | Mermaid CLI, mermaid and math parser chain | Keep provisionally; render real diagrams and a math-label fixture. Cross-minor pre-1.0 change deserves compatibility checks. PR's `^0.18.2` resolves to 0.18.10 |
| smol-toml 1.8.0 → 1.9.0 | CLI2 and Knip | Keep scoped CLI2 override; run Markdown and Knip checks; TOML tests where configuration actually uses TOML |
| source-map-js 1.2.1 → 1.2.2 | CSS/PostCSS/Tailwind | Keep; UI build/source-map smoke check |
| fast-copy 4.0.4 → 4.1.2 | pino-pretty | Keep; representative structured-log formatting |
| global-agent 3 → 4.1.3 | onnxruntime-node install/bootstrap | Keep provisionally; fresh native installation and embedding initialization; configured-proxy path where supported |
| matcher 3 → 4, serialize-error 7 → 8.1, nested type-fest change | Secondary global-agent chain changes | Cover with install/proxy/error-path checks; no separate migration |
| Removed roarr/sprintf-js and obsolete support dependencies | Consequence of global-agent change | Keep removal; verify absent in actual installed/package trees |
| Earlier broad overrides, including glob/minimatch/tar/undici | Predate PR #31 | Do not expand blindly; retain unless tests reveal breakage; record rationale and remove when parents support fixed versions natively |

Module-load/typecheck claims in the PR do not establish every behavior above. This reassessment did not rerun the full application or Mermaid renderer. These are acceptance checks, not a claim of passing final CI.

## Risk policy

Keep upstream severity/CVSS unchanged. Add **contextual risk, confidence, reachability, attacker input, impact, environment and verified controls**. Do not subtract arbitrary numeric points for dev dependencies. Release tools may hold publishing privileges and can be more consequential than runtime packages.

If a numeric score is useful later, use a complete, documented CVSS Environmental/Threat vector. EPSS is an exploitation-likelihood signal, not local severity; a low or missing value is insufficient to accept risk. [FIRST CVSS](https://www.first.org/cvss/v4.0/user-guide), [FIRST EPSS](https://www.first.org/epss/).

These are proposed repository targets, not externally mandated deadlines:

| Priority | Criteria | Gate / response |
| --- | --- | --- |
| P0 Critical | Malicious dependency, compromise, active exploitation with a plausible local path, exposed publish credentials | Stop affected publishing/deployment immediately; incident response; no routine exception |
| P1 High | Reachable serious confidentiality/integrity impact or exploitable availability failure of a critical service | Block affected release/deploy; mitigate promptly, target fix within 7 days; emergency acceptance explicit and at most 7 days |
| P2 Moderate | Plausible but bounded impact, or consequential uncertainty | Target remediation within 30 days; approved scoped exception permits delivery, normally max 30 days; uncertainty investigation within 3 working days |
| P3 Low | Bounded developer-job availability impact or evidence required exploit conditions are absent | Track; target compatible remediation within 90 days; initial exceptions 30 days, subsequent evidence-backed renewal at most 90 days |

Unknown does not mean safe. High upstream severity without a local assessment needs triage before approval. Where evidence is incomplete, use conditional temporary acceptance rather than a false not-affected assertion. New exploitation evidence can raise priority immediately.

### Expiring exceptions

Use a proposed `security/dependency-exceptions.json`, not a list of ignored package names. Each record identifies advisory aliases, exact package instance/version and dependency route, environment, upstream severity, contextual risk, confidence, rationale, evidence, controls, owner, approving maintainer, approval timestamp, expiry and tracking issue. Bundled components also identify their npm parent version/integrity.

Separate dispositions: fixed/removed, not-affected-with-evidence, temporary-risk-acceptance and under-investigation. A temporary exception accepts bounded risk; it does not dismiss the underlying advisory.

The supplied register's 13 entries are **proposed**, with approval/owner/issue fields intentionally unset. It cannot be loaded as active policy. If approved on 7 October, the npm brace-expansion interim records expire **21 October 2026** and the other initial records **6 November 2026**. Recompute expiry from actual approval; do not backdate approval.

Review seven days and one day before expiry through the existing daily Security workflow. Reassess immediately when a dependency route, relevant configuration or control changes; also on exploitation intelligence or advisory changes. When a compatible fixed parent/tool is available, open a targeted update and use a short target: 7 days for High, 14 days for Moderate/Low. Do not wait out the exception unnecessarily.

**Expiry is a review/approval deadline, not a promise that upstream will fix the package by then.** If exposure remains bounded and upstream has no fix, a maintainer can renew with fresh evidence. No automatic renewal. An expired exception must not continue bypassing a required gate; re-review, mitigate, update or explicitly renew. Advance reminders avoid surprise blockage while maintaining accountability. [Published exception-process example](https://handbook.gitlab.com/handbook/security/product-security/vulnerability-management/sla-exceptions/).

## Pipeline behavior

Always keep the full unfiltered scan, including dev dependencies. Produce a separate decision report showing raw findings, accepted risk, pending reviews, expiry and blockers. A passing check should say **“policy satisfied with N accepted findings”**, not “zero vulnerabilities.”

| Situation | Behavior |
| --- | --- |
| Existing finding with valid instance-specific assessment/acceptance | Continue; show it in the report |
| New upstream high/critical or new serious local exposure | Require assessment before merge; stop affected release when P0/P1 criteria apply |
| New low/moderate finding without dangerous local indicators | Visible triage queue, assessment target 3 working days; do not call it approved or fixed |
| Exception expired or control invalidated | Reassess; approval no longer bypasses gate; owner can renew without waiting for upstream |
| Compatible update available | Targeted remediation PR with functional checks; no automatic major downgrade |
| Audit service error | Retry; never convert error to clean; keep build/test jobs running while security needs attention |

Run functional jobs independently so a security decision does not hide other test results. Keep merge/release protected by the required policy result and existing quality checks. For scanner outages, an optional explicit policy may permit a clearly marked report at most 24 hours old for an unchanged dependency graph and valid decisions. Changed graphs and releases require a fresh successful assessment. Cache use must not renew exception expiry.

Align dependency-review with the evaluator: it currently independently blocks at upstream high, so it would contradict approved exceptions. Preserve it as inventory/input and keep a **protected required policy check** as the enforcement point. Do not make checks advisory before replacement enforcement is verified.

Resolve audit parent/peer cycles to their advisory instances; do not subtract raw counts or ignore whole parent packages. A new GHSA on the same package, a different version/route, or a runtime copy of a dev-scoped exception requires its own decision. Hash relevant evidence/config/dependency routes rather than the entire repository: an unrelated commit should not invalidate every assessment.

Protect policy and evaluator changes with enforced maintainer review. A PR cannot add an ignore and approve itself or weaken its own gate. Evaluate using trusted base-branch policy; activate new decisions through a separately reviewed control-plane path. Verify actual branch rules, not just CODEOWNERS text. Never execute untrusted PR content with privileged `pull_request_target` credentials to implement approvals. [GitHub security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Keep scheduled scanning and reminders in the existing workflow. Group related root advisories into actionable work rather than generating 16 duplicate tickets. Inventory both the project npm and runner/global npm; retain the existing separation of container/OS scanning into the containers repository, with clear ownership instead of claiming npm audit covers it.

## Implementation packets

1. **Confirm and approve bounded assessments.** Preserve PR #31 and its compatible fixes. Inventory exact npm executables; complete npm brace-expansion tracing, exploitation-intelligence checks and cache/credential-boundary verification. Review the draft register; no automated approval.
2. **Add a small policy evaluator.** Use Node built-ins to validate audit JSON and policy, match exact instances, normalize aliases and resolve propagated findings. Preserve upstream data; emit both machine and human reports with explicit error/expiry states.
3. **Align CI and remediation automation.** Replace `security.yml`'s production-only audit gate; reconcile dependency review. Update `scripts/ci-audit.mjs`, `scripts/npm-audit-fix.sh` and tests to remove blind force downgrades. Permit compatible incremental fixes while unrelated accepted findings remain. Require no new unaccepted material risk and demonstrated targeted improvement, rather than raw total=0. Preserve manifest-only automation permissions.
4. **Validate fixes and docs coverage.** Run SDK, quoting, Mermaid/KaTeX, CSS, logging and native-install/proxy checks plus existing Node 24/26 gates. Add explicit isolated Mermaid validation. Preserve semantic-release, OIDC, version/source identity and recovery behavior.
5. **Verify governance and enable review cadence.** Test actual required-check behavior and policy-change approvals; add expiry notifications and targeted update work to the existing scheduled workflow. Track accepted findings, oldest unreviewed risk and time to compatible fixes.

Evaluator acceptance tests must cover: dev-only high finding with exact exception; new GHSA on same package; second runtime instance; expired and unapproved records; alias deduplication; dependency cycles; UTC expiry boundaries; changed controls; malformed/service-error responses; visible low-only findings; inability of a PR to self-approve; and partial remediation while other approved findings remain. Demonstrate both permitted low-exposure risk and blocked simulated publishing-credential impact.

## Disposition of earlier alternatives

| Proposal | Revised decision |
| --- | --- |
| Replace semantic-release with release-it | Withdraw; unnecessary release migration and added proxy/FTP obligations |
| Replace CLI2 with markdownlint-cli | Optional future simplification, not required remediation now |
| Downgrade CLI2 to audit-suggested old release | Reject |
| Fork/rebuild npm with a cache patch | Withdraw; no established npm exploit warrants ownership burden |
| Migrate to pnpm | Not justified by these findings alone; assess independently for developer/product benefits |
| Alias/patch braces or micromatch | Not justified for inspected bounded patterns; pursue upstream fix with scoped acceptance |
| Ignore all dev dependencies or retain production-only gate | Reject; loses build/release visibility |
| Force changes until raw count is zero | Reject; compatibility and actual risk determine action |
| Compatible updates, upstream fixes, least privilege, isolated jobs | Keep and verify |

Remaining work is explicit: exception approval, actual control verification, npm glob-input tracing, exploitation-intelligence checks and functional validation of cross-range overrides. None requires an indefinite wait for an upstream release; none is presented as a completed fix.
