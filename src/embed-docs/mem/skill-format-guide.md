---
version: "4.8.6"
slug: skill-format-guide
title: Skill Format and Local Authoring Guide
---



# Skill Format and Local Authoring Guide

Decision rules for authoring SKILL.md files, choosing between local (git) and
server (SQUADRULES) storage, and quality gates for skill content. Fetches the
current Agent Skills format spec (Context7 or agentskills.io) as the
authoritative generic format, then layers SQUADRULES customizations on top. Loaded
by protocol-authoring agents during drafting and review when the output format
is `skill`.

## Activation Patterns

**Typically invoked by:** `create-new-protocol` and
`phase-critic`.

**Can be invoked directly when agent needs:**
- "SKILL.md format reference" / "how to write a skill"
- "latest SKILL.md spec" / "current agentskills format"
- "skill vs adapter" / "local skill or SQUADRULES adapter"
- "skill quality gates" / "SKILL.md structure"
- "project-level skill" / "where to put a skill"

**Trigger pattern:** **skill** + (format | structure | guide | quality | local | spec).

**Must Never:**
- Be used as an execution protocol.
- Recommend storing a skill in both git AND SQUADRULES server simultaneously.
- Confuse SKILL.md (agent instruction file) with protocol markdown (adapter).
- Hardcode the generic SKILL.md format from memory when the current spec is
  reachable via Context7 or agentskills.io.

**Must Always:**
- Be consulted before writing any SKILL.md file.
- Fetch the current Agent Skills spec before authoring or reviewing generic
  format, and apply SQUADRULES customizations after it.
- Enforce single source of truth: each skill lives in exactly one place.
- Match storage location to the skill's scope and discoverability needs.

**Good trigger examples:**
- drafting a new skill and need format rules → load this
- reviewing a SKILL.md for quality → load this
- deciding local vs server for a skill → load this

**Bad trigger examples:**
- "which challenge type for this step?" → use `challenge-type-guide`
- "create a new protocol" → use `create-new-protocol`

## Storage Decision

Every skill has ONE home. Choose at authoring time. Never both.

| Scope | Storage | Discovery | Source of Truth |
|---|---|---|---|
| Project-specific (deploy, test, release) | Git: `.agents/skills/{name}/` or `.cursor/skills/{name}/` | IDE host scans description field | Git repo |
| Personal cross-project (universal) | SQUADRULES server via `train` | `activate` embedding search | SQUADRULES server |
| Team/group shared | SQUADRULES server (group space) | `activate` | SQUADRULES server |

### Decision Tree

```
Is this skill specific to ONE project's codebase?
 ├─ YES → Does it reference repo files, paths, or project-specific tools?
 │         ├─ YES → LOCAL (git)
 │         └─ NO  → Could it help in other projects?
 │                   ├─ YES → SERVER (SQUADRULES)
 │                   └─ NO  → LOCAL (git)
 └─ NO → SERVER (SQUADRULES)
```

### Local Storage Paths

| Host | Path | Scope |
|---|---|---|
| Cursor IDE (project) | `.cursor/skills/{name}/SKILL.md` | Repo-scoped, git-controlled |
| Cursor IDE (personal) | `~/.cursor/skills/{name}/SKILL.md` | User-wide, all projects |
| Claude Code (project) | `.agents/skills/{name}/SKILL.md` | Repo-scoped, git-controlled |
| Claude Code (personal) | `~/.agents/skills/{name}/SKILL.md` | User-wide, all projects |

**Never** create skills in `~/.cursor/skills-cursor/` — reserved for system.

### Promotion and Demotion

**Local → Server (skill graduates to universal):**
1. Read existing SKILL.md
2. Optionally wrap in protocol structure (Activation Patterns, contracts)
3. `train` to SQUADRULES server
4. Delete local copy or mark deprecated
5. Git commit the deletion

**Server → Local (adapter becomes project-specific):**
1. `export` with `format: skill_zip` or `format: markdown`
2. Write to `.agents/skills/{slug}/SKILL.md`
3. Optionally `delete` from server

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Fetch the Current Skill Format Spec

Do NOT rely on a frozen copy of the SKILL.md format. The Agent Skills format
evolves (new frontmatter fields, directory conventions, size guidance). Before
authoring or reviewing a SKILL.md, fetch the **current** specification and treat
it as authoritative for the generic format. The SQUADRULES customizations in the
sections *after* this one layer on top of that generic spec.

**Authoritative source (fetch fresh — do not guess):**

1. **Context7 (preferred):** query the Agent Skills docs library for the
   SKILL.md format. Use one of these library IDs directly (skip
   `resolve-library-id`):
   - `/llmstxt/agentskills_io_llms-full_txt` — full spec text (best coverage)
   - `/websites/agentskills_io` — the agentskills.io site docs
   Example query: "SKILL.md frontmatter fields, directory structure, size limits".
2. **URL fallback:** if Context7 is unavailable or returns nothing usable,
   fetch `https://agentskills.io/specification`. Use
   `https://agentskills.io/llms.txt` as the documentation index to discover
   related pages.

**What to extract from the fetched spec (do not hardcode from memory):**
- Required and optional YAML frontmatter fields and their constraints
  (for example `name`, `description`, and any newer fields such as `license`,
  `compatibility`, `metadata`, `allowed-tools`).
- Directory structure and conventional subdirectory names
  (for example `scripts/`, `references/`, `assets/`).
- Body content recommendations and section guidance.
- Size / progressive-disclosure guidance (line and token targets).
- Any spec-provided validation tooling (for example `skills-ref validate`).

**Rules:**
- Apply the fetched spec's constraints exactly for the generic format.
- If the fetch fails on BOTH Context7 and the URL, STOP and tell the user the
  spec is unreachable — do not fabricate field lists or limits from memory.
- Record which source and (if available) which version/date you fetched, so the
  authoring decision is auditable.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## SQUADRULES Customizations (apply after the generic spec)

Everything below is SQUADRULES-specific and layers on top of the fetched Agent
Skills spec. When the generic spec and these rules disagree on generic format,
follow the spec; these rules add SQUADRULES storage, integrity, and routing
behavior the generic spec does not cover.

### SQUADRULES additions to structure

- **`SHA256SUMS`** — required for SQUADRULES-exported skill bundles (GNU
  `sha256sum` format, paths relative to the skill dir). This is a SQUADRULES
  integrity requirement, not part of the generic Agent Skills spec.
- **`disable-model-invocation`** — when the host supports it, SQUADRULES-authored
  skills default this to `true` (explicit load only) unless the skill is meant
  to auto-trigger. Only add fields the fetched spec actually recognizes.
- **Reference depth** — keep references one level deep (SKILL.md → reference
  file, never deeper), consistent with the spec's progressive-disclosure model.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Quality Gates

### Description Quality

The description is the primary discovery mechanism. It must:

1. Be written in **third person** (not "I can help" or "you can use")
2. State **WHAT** the skill does (specific capabilities)
3. State **WHEN** to use it (trigger scenarios, file patterns, keywords)
4. Include **trigger terms** that match real user language
5. Avoid vague words: "helps with", "assists", "various"

**Good:**
```yaml
description: >-
  Validate and publish Confluence pages managed as local markdown via Mark CLI.
  Use when the user asks to dry-run, validate, publish, or sync a Confluence
  page, or when working with files under confluence/ that have Mark metadata.
```

**Bad:**
```yaml
description: Helps with Confluence stuff.
```

### Content Quality

| Check | Rule |
|---|---|
| Consistent terminology | One term per concept throughout |
| No time-sensitive info | No "before August 2025" conditions |
| Concrete examples | Real inputs/outputs, not abstract |
| Actionable instructions | Agent knows what to DO, not just what exists |
| Default tool choice | One recommended tool, escape hatch for alternatives |
| No Windows paths | Forward slashes only |

### Degree of Freedom

Match instruction specificity to the task's fragility:

| Level | When | Example |
|---|---|---|
| High (text guidelines) | Multiple valid approaches | Code review guidelines |
| Medium (templates/pseudocode) | Preferred pattern, acceptable variation | Report generation |
| Low (exact scripts) | Fragile operations, consistency critical | DB migrations |

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Finalisation Paths

### Path A: Local Write (project-level skill)

When `{target}=local`:

1. Determine output path from scope:
   - Project Cursor: `.cursor/skills/{name}/SKILL.md`
   - Project Claude: `.agents/skills/{name}/SKILL.md`
   - Personal: `~/.cursor/skills/{name}/SKILL.md` or `~/.agents/skills/{name}/`
2. Create directory if needed
3. Write SKILL.md with frontmatter and body
4. Generate `SHA256SUMS` (GNU sha256sum format, paths relative to skill dir)
5. Write any reference files and scripts
6. Verify: `test -f "{path}/SKILL.md" && wc -l "{path}/SKILL.md"`
7. Report path and line count to user

Do NOT call `train`. The skill lives only in git.

### Path B: Server Train (SQUADRULES-routable adapter)

When `{target}=server`:

1. Wrap skill content in protocol markdown if needed:
   - Add Activation Patterns (first H2)
   - Add contract blocks per layer
   - Add Reward Signal (last H2)
2. Call `train` with full markdown
3. Verify adapter URI returned
4. Report URI and slug to user

Do NOT write to local disk. The adapter lives only in SQUADRULES.

### Path C: Hybrid Authoring (skill that is also an adapter)

When `{target}=hybrid` (rare — use only when explicitly requested):

1. Author as a SQUADRULES protocol (Activation Patterns, contracts, Reward Signal)
2. `train` to server
3. `export` with `format: skill_zip` to produce local SKILL.md bundle
4. The exported SKILL.md is a **read-only derived artifact**, not a source of truth
5. Document in the SKILL.md header that it was exported from SQUADRULES

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The agent can now:
1. Fetch the current Agent Skills spec (Context7 or agentskills.io) instead of
   relying on a frozen copy, and apply it as the authoritative generic format
2. Layer the SQUADRULES customizations (storage, `SHA256SUMS`, routing) on top of
   that fetched spec
3. Choose the correct storage location for a skill
4. Author SKILL.md with valid frontmatter and structure per the current spec
5. Apply quality gates to descriptions and content
6. Finalize via local write OR server train (never both)
7. Produce SHA256SUMS for integrity verification
