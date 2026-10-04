# AI CODING RULES

THIS IS TEST FILE, NOT ACTUAL LATEST SET OF RULES
USE SQUADRULES !!!!

November 24, 2025

It is the law for every agent that writes code.  
Every change MUST follow CHECK LOCAL DOCUMENTATION FOR BUILD, DEPLOY, AND TEST (foundational rule) and then sections 0-10 in exact order.
Deviation = automatic failure rating on the entire adapter run.

Execute.

---

## Activation Patterns

Run when user says "AI coding rules" or "coding rules".

## AI-FRIENDLY COMMUNICATION AND TOOL USAGE

**Use AI-friendly, prompt-like language:**

- Write instructions as clear, actionable prompts
- Use imperative mood ("Run tests", "Check logs", "Verify status")
- Be explicit about what to do, when to do it, and what success looks like
- Avoid ambiguous or implicit requirements

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## CHECK LOCAL DOCUMENTATION FOR BUILD, DEPLOY, AND TEST

**Check local docs for Build, Deploy, and Test instructions. You MUST ONLY use Build, Deploy, and Test tools from these instructions.**

1. Read README.md to find Build, Deploy, and Test commands
2. Use ONLY the documented npm scripts (e.g., `npm run dev:build`, `npm run dev:deploy`, `npm run dev:test`)
3. DO NOT invent or assume build/test/deploy commands - use what's documented

**If instructions are failing or incomplete:**

- STOP execution
- ASK the user: "The [build/deploy/test] command in README.md is failing/incomplete. May I update the documentation or try an alternative approach?"
- DO NOT proceed with alternative commands without permission

**Use the same methodology:**

- When documenting or updating instructions, use the same prompt-like, AI-friendly language
- Be explicit about what to do, when to do it, and what success looks like

This rule applies to ALL subsequent numbered sections that require Build, Deploy, or Test operations.

Proof of work: rg -n "Build|Deploy|Test" README.md

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## ESTABLISH BASELINE

**Follow CHECK LOCAL DOCUMENTATION FOR BUILD, DEPLOY, AND TEST: Check README.md for test commands. Use ONLY the documented npm scripts.**

1. Read README.md to find the correct test command
2. Run the documented test command (e.g., `npm run dev:test`)
3. Archive output: `reports/tests/baseline-<timestamp>.log`
4. Record commit hash and branch

Proof of work: stat `reports/tests/baseline-<timestamp>.log`

**CRITICAL: Only proceed if ALL tests pass with zero failures.**

- If ANY test fails in baseline ← STOP immediately and escalate to human
- DO NOT proceed with work if baseline has failures
- DO NOT claim tests were "pre-existing failures" without absolute proof
- DO NOT use "it was like that when I got here" as an excuse
- Baseline must be 100% green: `Test Suites: X passed, X total` and `Tests: Y passed, Y total` with ZERO failures

If baseline has any failures ← STOP and escalate to human. Do not proceed.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## CREATE ISOLATED BRANCH

`git checkout -b <type>/<short-slug>`

**Branch naming conventions:**

- Format: `<type>/<short-slug>`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Short-slug: lowercase, hyphenated, descriptive (max 40 chars)
- Examples:
  - `feat/add-mcp-resource-handler`
  - `fix/memory-store-race-condition`
  - `docs/update-coding-rules`
  - `test/add-integration-tests`

No work ever happens on main or any shared branch.

Proof of work: git rev-parse --abbrev-ref HEAD | grep -v main

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## WRITE A 3': BULLET PLAN

Scope, files touched, success criteria.  
Post the plan. Wait for acknowledgment if scope is unclear.

Proof of work: post the exact 3' bullet plan in the log before coding.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## REPRODUCE OR SPECIFY TARGET BEHAVIOR

For bugs: reproduce deterministically.  
For features: add a failing test that encodes the desired outcome.

No implementation before the test exists or failure is proven.

Proof of work: capture failing test output or repro steps in `reports/tests/repro-<timestamp>.log`.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## MINIMAL IMPLEMENTATION

Change the smallest possible surface.  
Touch only planned files. Keep existing style. No unrelated cleanups.

Proof of work: run `git diff --stat` to prove the surface stayed minimal.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## RUN FULL TEST SUITE

**Follow CHECK LOCAL DOCUMENTATION FOR BUILD, DEPLOY, AND TEST: Check README.md for test commands. Use ONLY the documented npm scripts.**

1. Read README.md to find the correct test command
2. Run the documented test command (e.g., `npm run dev:test`)
3. Capture output to temporary file: `reports/tests/test-{timestamp}.log`
4. All tests MUST pass

**DO NOT claim test failures are "pre-existing" without proof from baseline log.**

- Compare test results to archived baseline log
- If failures match baseline exactly and you didn't cause them, escalate to human
- Do not proceed with commit if you introduced any new failures
- All tests must pass: `Test Suites: X passed, X total` and `Tests: Y passed, Y total` with ZERO failures

If any test fails → return to REPRODUCE OR SPECIFY TARGET BEHAVIOR or MINIMAL IMPLEMENTATION. Do not weaken assertions.

Proof of work: `tail -n 20 reports/tests/test-<timestamp>.log` showing all suites/tests passed.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## HYGIENE

Run linters/formatters. Remove debug prints. Scan for secrets. No dead code.

Proof of work: `npm run lint -- --max-warnings=0` and archive the final summary.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## SINGLE FOCUSED COMMIT (EVIDENCE)

**Proof of work = git commit + test log stored locally in temporary files**

One logical change = one commit.

**Workflow:**

1. Run tests and capture output to temporary file: `reports/tests/test-{timestamp}.log`
2. Verify all tests pass
3. Create commit with clean message (no test evidence in commit)
4. Push to PR/MR
5. Update user request (Jira ticket) with git hashes or MR link (which includes git hashes)

**Commit message format:**

```
type(scope): imperative summary

Optional body explaining what and why (not how).
```

**Commit message best practices:**

- **Type** (required): `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `style`
- **Scope** (optional): affected module/component (e.g., `memory`, `mcp-handler`, `tools`)
- **Summary** (required): imperative mood, lowercase, no period, max 72 chars
- **Body** (optional): explain what and why, wrap at 72 chars
- **Examples:**
  - `feat(memory): add adapter reconstruction from fragments`
  - `fix(mcp-handler): resolve race condition in concurrent updates`
  - `docs(coding-rules): update git branch naming conventions`
  - `test(tools): add integration tests for train`

**Proof of work logging:**

- Test logs stored locally in `reports/tests/test-{timestamp}.log`
- Log includes: timestamp, test summary, all tests pass status
- Log format example:

  ```
  2025-01-15 14:30:22 UTC

  Test Suites: 16 passed, 16 total
  Tests:       33 passed, 33 total
  Time:        38.243 s
  ```

- Reference log file when updating user request (Jira ticket) with git hashes

No commit is valid without a corresponding green test log in temporary files.

Proof of work: `git show --stat HEAD` linked to the matching test log.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## FINAL VERIFICATION (VALIDATION)

**Proof of work is only accepted when:**

- A git commit exists
- Test log in `reports/tests/test-{timestamp}.log` shows **ALL tests pass**
- Implementation log contains the commit hash and path to test log

All of the following must be true:

- Baseline archived and was 100% green (zero failures)
- Plan followed or deviations documented
- All changes minimal and in scope
- Full test suite green with test log in `reports/tests/test-{timestamp}.log` (zero failures)
- Commit exists with clean message (no test evidence in commit)
- No disabled or weakened tests
- No claims of "pre-existing failures" without baseline proof

**FORBIDDEN:**

- Claiming "it was like that when I got here" about test failures
- Proceeding when baseline had failures
- Claiming failures are pre-existing without comparing to baseline log
- Committing code that introduces test failures

If any item fails → return to the numbered section that failed.

Proof of work: record the commit hash + test log path inside the implementation log.

```json
{"contract": {"type": "comment", "comment": {"min_length": 1}, "required": true}}
```

## HANDOFF

Provide:

- One-sentence summary of what changed
- Exact commands to validate
- Direct path to the green test log
- Commit hash
- Any remaining risks

Proof of work: final response must include summary, validation commands, test log path, and risks.

## Reward Signal

Only reachable after all prior steps are solved.
