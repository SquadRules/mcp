# Code security setup (GitHub)

Enable and enforce code-security for this repo. Requires **admin** (or owner) access.

## 1. Require Security workflow on `main`

PRs must pass the Security workflow (dependency review, npm audit, CodeQL) before merge.

**UI:** Settings → Branches → rule for **main** → Require status checks → add **Dependency review**, **npm audit**, **CodeQL**.

**`gh` CLI** (overwrites existing required checks for `main` with exactly these three; run from repo root):

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo '{
  "required_status_checks": {"strict": false, "contexts": ["Dependency review", "npm audit", "CodeQL"]},
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}' | gh api -X PUT "repos/${REPO}/branches/main/protection" --input -
```

To preserve existing rule settings (e.g. required reviewers), GET the current protection, edit the JSON, then PUT: `gh api "repos/${REPO}/branches/main/protection"` then pipe edited JSON to `gh api -X PUT ... --input -`.

## 2. Secret scanning (and push protection)

**UI:** Settings → Code security and analysis → turn on **Secret scanning** and **Push protection**.

**`gh` CLI:**

```bash
gh api -X PATCH "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  -f security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}'
```

If the API rejects (e.g. org policy or plan), use the UI. Public repos get this for free.

## Summary

| Feature                  | UI                                         | `gh` |
| ------------------------ | ------------------------------------------ | ---- |
| Require Security on main | Settings → Branches → main                 | `gh api -X PUT .../branches/main/protection` (see above) |
| Secret scanning + push   | Settings → Code security and analysis     | `gh api -X PATCH .../repos/OWNER/REPO` (see above) |
