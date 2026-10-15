# ADR 0020: CodeQL false positives are excluded in codeql-config.yml, not via inline comments

## Status

Accepted

## Context

GitHub code scanning (the `codeql` job in `.github/workflows/security.yml`,
`queries: security-extended`) reported two open `high` alerts of rule
`js/user-controlled-bypass` in `src/http/http-auth-middleware.ts`:

- Alert 1 — the `if (hasBearerReq)` guard (line ~231). `hasBearerReq` is derived
  from the presence of the `Authorization` request header.
- Alert 2 — the `if (isRecognizedGetRequest(req) && !isMcp)` guard (line ~301).
  `isRecognizedGetRequest` is derived from `req.method`.

Both are false positives. Neither guard grants unauthenticated access:

- The Bearer branch cryptographically validates the token (issuer, audience,
  `exp`) via `validateBearerToken` against the configured `AUTH_TRUSTED_ISSUERS`
  and `AUTH_ALLOWED_AUDIENCES` before calling `runNext`; a missing config,
  invalid, or expired token returns `401`. Absence of a Bearer header simply
  falls through to the session / `401` / login-redirect path.
- The redirect branch only issues a `302` to a server-generated OIDC login URL
  (`redirectBrowserToOidcLogin`) for a recognized `GET`, and every other
  verb/path returns `401` JSON. The redirect target is never user-controlled.

The query is inherently noisy on auth middleware: any branch whose condition
depends on request data (headers, method) that leads to a "sensitive action"
(here `next()` / a redirect) is flagged, regardless of the validation that
follows.

The code already carried inline `// codeql[js/user-controlled-bypass]: ...`
comments above both guards (added in `37666e75` / `d4230545`, March 2026), yet
the alerts stayed open. The scanned default-branch commit `2b225cd7` contained
those comments. The reason is that **GitHub code scanning does not honor inline
`// codeql[...]` or `// lgtm[...]` suppression comments at all** — confirmed by
CodeQL maintainers in [github/codeql#9298](https://github.com/github/codeql/issues/9298):
CodeQL's `AlertSuppression.ql` only tags the SARIF result with a `suppressions[]`
entry; converting that into a dismissed alert requires the separate
[`advanced-security/dismiss-alerts`](https://github.com/advanced-security/dismiss-alerts)
action or a manual dismissal. This pipeline runs neither, so the inline comments
were inert.

The repository already suppresses two other false-positive queries
(`js/file-access-to-http`, `js/http-to-file-access`) through `query-filters`
exclusions in `.github/codeql/codeql-config.yml` — the mechanism that actually
works here.

## Decision

Exclude false-positive CodeQL queries via `query-filters` in
`.github/codeql/codeql-config.yml`, with an inline justification comment above
the filter naming the affected source and why it is a false positive. This ADR
applies that established mechanism to `js/user-controlled-bypass`:

```yaml
query-filters:
  - exclude:
      id: js/user-controlled-bypass
```

Inline `// codeql[...]` comments are kept at the flagged sites as code-local
documentation of *why* the branch is safe, but they are understood to be inert
for suppression; the authoritative suppression is the config exclusion.

## Consequences

### Positive

- The two open `high` alerts clear on the next default-branch scan, and the
  rule no longer produces false positives on the auth middleware.
- Suppression now uses a mechanism the pipeline actually honors, so the config
  is self-consistent (no reliance on inert comments).
- The false-positive rationale lives in two discoverable places: the config
  comment (next to the filter) and this ADR.

### Negative

- `query-filters` exclusion is repository-wide: a *genuine*
  `js/user-controlled-bypass` introduced anywhere in the codebase would also be
  suppressed and would not surface as an alert. This is the same trade-off
  already accepted for the two previously excluded queries.
- Re-enabling the query for the whole repo would re-open these two false
  positives unless a more targeted mechanism is adopted first.

## Alternatives Considered

### Add the `advanced-security/dismiss-alerts` action

Wire `codeql-action/analyze` to emit SARIF to a directory and add a
`dismiss-alerts` step (default-branch only) so the existing inline
`// codeql[...]` comments dismiss exactly the two alerts while keeping the query
active elsewhere. Rejected for now: it adds a third-party action to a
workflow validated by `scripts/ci-validate-workflows.mjs` (SHA-pinning and
the "Automation policy passed" gate), which is a larger, riskier change than
the config exclusion. This is the preferred path if the repo later wants
per-line suppression without disabling the query globally.

### Restructure the middleware so CodeQL no longer flags it

Rejected: any restructuring would be cosmetic obfuscation. The branches must
select on request data by design, and the validation that makes them safe is
already present; changing the shape would not improve security and could
reduce clarity.

### Dismiss the two alerts manually in the UI/API

Rejected as the sole fix: dismissal is not captured in the repo, does not
prevent recurrence on the next scan of equivalent code, and produces no
reviewable artifact.

## Reopen condition

Revisit this decision if GitHub code scanning gains native inline
suppression-comment support (tracking issue
[github/codeql#9298](https://github.com/github/codeql/issues/9298)), or if a
genuine `js/user-controlled-bypass` finding is missed because of the global
exclusion. In either case, prefer the targeted `dismiss-alerts` mechanism over a
repo-wide query exclusion.

## Evidence

- Open alerts before the change:
  [code-scanning/1](https://github.com/SquadRules/mcp/security/code-scanning/1)
  and [code-scanning/2](https://github.com/SquadRules/mcp/security/code-scanning/2),
  both `js/user-controlled-bypass`, `high`, in `src/http/http-auth-middleware.ts`.
- Scanned commit `2b225cd7` contained the inline comments; alerts still open —
  `gh api repos/SquadRules/mcp/code-scanning/alerts/{1,2}`.
- Upstream confirmation that inline comments are not applied by code scanning:
  [github/codeql#9298](https://github.com/github/codeql/issues/9298).
- Existing precedent: `js/file-access-to-http` and `js/http-to-file-access`
  already excluded in `.github/codeql/codeql-config.yml`.

## Related

- `.github/codeql/codeql-config.yml`
- `.github/workflows/security.yml`
- `src/http/http-auth-middleware.ts`
