---
kind: external_dependency
name: Qoder RepoWiki — code-derived wiki generator
slug: qoder-repowiki
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### Qoder RepoWiki
- Role: IDE-side knowledge generator that reads `.qoder/repowiki/wiki_plan.yaml` and produces nested Markdown under `.qoder/repowiki/en/content/`; the project's `docs/` tree is reserved for non-code-derivable records (ADRs, threat model, Keycloak setup).
- Framework behavior: generation is triggered inside the Qoder IDE (command palette / sidebar panel), not via a repo-local script; the repo ships only the post-processing scripts `scripts/build-wiki.mjs` (flatten nested tree → flat GitHub Wiki format) and `scripts/sync-wiki.sh` (rsync to the GitHub Wiki repo).
- Sync pipeline: `.github/workflows/sync-qoder-repowiki-to-github-wiki.yml` watches `.qoder/repowiki/en/content/**`, `wiki_plan.yaml`, and the build scripts, then pushes to `https://github.com/SquadRules/mcp/wiki`.
- Governance: `documentation-authority.md` (under `.qoder/rules/`) defines which facts belong in the generated Wiki vs. hand-maintained `docs/`.