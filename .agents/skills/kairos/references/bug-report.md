<!-- squadrules-compat-surface: skill directory + name: frontmatter (kairos / kairos-dev) are retained invocation identifiers; path/filename rename is an explicit non-goal and body prose references these names plus the retained kairos CLI alias -->
# Bug report — structured MCP failure capture

Produce a structured Markdown bug report for the latest MCP interaction,
especially KAIROS MCP failures. Use when the user asks for an MCP bug report
or to document a failed MCP tool or resource call. Save the report under
`reports/` with secrets redacted, using the latest relevant interaction unless
the user points to a specific call.

**MISSION:** Produce a single Markdown bug report for the latest MCP
interaction (or a user-specified one). Keep an exact 1-to-1 mapping
between the structure below and the report: every section in this order,
with no extra top-level sections. The Calls and responses section must be
a **raw JSON trace** of each request and response, with redaction only.

**STRUCTURE (exact order, never skip):**
1. Summary
2. Calls and responses
3. Reasoning
4. Environment / context
5. Reproduction
6. Checklist before saving

**BEFORE WRITING:** If the KAIROS MCP server is reachable, call its
`/health` endpoint (HTTP GET to `<KAIROS_API_URL>/health`) or equivalent
and capture the response. This provides the server version and
infrastructure component status needed for the Environment section.

**CONTENT TYPES:**
- **Summary:** One sentence: failure + MCP server name + tool/resource.
- **Calls and responses:** For **every** call in the failing flow
  (activate, each forward attempt, reward): request in fenced `json`
  (server, tool/resource, arguments) **immediately followed by** its
  response in fenced `json` (full payload or error). Preserve
  chronological order.
  - **Raw trace rule:** Request and response blocks must be raw,
    verbatim JSON payloads from execution (except redaction of secrets).
    Do not paraphrase, normalize, summarize, or rewrite JSON fields.
  - **Retry rule:** When a flow ends in `MAX_RETRIES_EXCEEDED` or
    similar retry exhaustion, include **every** retry attempt
    (request + response), not just the first and last. If `retry_count`
    is N, the report must contain N request-response pairs for that
    step. A reader must be able to see exactly what changed (or did not
    change) between attempts.
  - Never omit intermediate successful responses — they are essential
    for diagnosing state drift.
- **Reasoning:** Must include:
  - Why each call was made and how each response was interpreted.
  - **Fault attribution (mandatory when retries > 0):** For each failed
    attempt, state whether the agent followed the server's
    `next_action`, used the current `nonce`/`proof_hash`/`uri` from
    the latest response, or deviated. Classify the root cause as one
    of:
    - **agent error** — agent ignored server guidance, reused stale
      values, targeted wrong URI, or sent wrong solution type.
    - **server error** — agent followed guidance correctly but server
      rejected valid input or returned inconsistent state.
    - **unclear** — insufficient evidence to determine fault.
  - If the agent caused retries by ignoring server responses, the
    report must say so. Do not attribute agent errors to the server.
- **Environment / context:** Must include:
  - **KAIROS MCP version** (from `/health` `version` field, or from
    MCP server connect banner if available).
  - **Infrastructure status** (Qdrant, Redis/cache, embedding) — one
    line each: healthy / unhealthy / degraded / not configured. Source
    this from `/health` `dependencies` object.
  - **OS and IDE** (OS version, Cursor/IDE version if available).
  - **Relevant config/env names** only. Never include secret values.
- **Reproduction:** Minimal steps; expected vs. actual in one or two
  sentences.
- **Checklist before saving:** Markdown task list (`- [ ]`) with the
  items below.

**MUST:**
- Emit all six sections in order.
- Use fenced code blocks with language `json` for every request and
  response.
- Keep request and response blocks as **raw/verbatim JSON trace**
  (redaction-only edits are allowed).
- Redact secrets, tokens, cookies, and API keys in any JSON.
- Save under `reports/` as
  `mcp-bug-<server>-<short-description>-<date>.md`.
- Complete the checklist in the report before saving.

**MUST NOT:**
- Add top-level sections not in STRUCTURE (for example Appendix, Notes,
  or Extra).
- Omit or reorder sections.
- Omit retry attempts. If `retry_count` is N, all N request-response
  pairs must appear. Showing only the first and final attempt is
  forbidden.
- Attribute agent execution errors to the server. If the agent reused a
  stale nonce, targeted the wrong URI, or ignored `next_action`, the
  Reasoning section must classify this as agent error.
- Put request/response in plain text or non-JSON code blocks.
- Paraphrase, normalize, or rewrite request/response JSON instead of
  preserving a raw trace (except redaction).
- Include unredacted secrets, tokens, cookies, or API keys.

---

## Checklist before saving

- [ ] Summary states server, tool/resource, and the failure in one
  sentence.
- [ ] Every MCP call in the flow has both request **and** response JSON
  blocks — including **all retry attempts** (no skipped intermediate
  responses), with secrets redacted and raw/verbatim JSON preserved.
- [ ] Reasoning includes explicit fault attribution for each failed
  attempt (agent error / server error / unclear) with evidence.
- [ ] Environment includes KAIROS MCP version and infrastructure
  component status (Qdrant, Redis/cache, embedding).
- [ ] Reproduction steps are minimal and someone else could follow them.
- [ ] File is saved in `reports/` with filename
  `mcp-bug-<server>-<short-description>-<date>.md`.
