## Low-memory hosts: CI owns lint and tests

Some hosts cannot hold this repository's repo-wide gates in memory.

**Observed on this device** (Termux on Android, arm64, node 24, ~3.2 GB available of
11 GB): `npx eslint .` aborts with `FATAL ERROR: Ineffective mark-compacts near heap
limit` at the default ~1 GB V8 heap, and the `.husky/pre-commit` hook fails with code
1 for that reason alone. The same commit passes on CI runners. Giving eslint a 3 GB
heap made it pass in about four minutes — slow, and it competes with the human's own
work for the device.

**Inference, not observation:** `npm test`, `npm run typecheck` and `npm run build`
were not measured here. They build comparable or larger type/test programs, so treat
the threshold below as the trigger instead of waiting for an abort to prove it.

That failure describes the host, not the branch. Re-running it locally is not
verification; it is a second measurement of the same constraint.

### Decide the host once

```bash
sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\) kB$/\1/p' /proc/meminfo | head -n 1
```

Below 4 194 304 kB (4 GB available) is a low-memory host for the rest of the task.
`.husky/pre-commit` applies the same 4096 MB rule and defers `eslint .` automatically
while still running the light linters. Override either way with
`SQUADRULES_PRECOMMIT_LINT=force` or `SQUADRULES_PRECOMMIT_LINT=skip`.

### Must never on a low-memory host

- Run `npm run lint`, `npx eslint .`, `npm test`, `npm run typecheck`,
  `npm run build`, or `npm run test:tgz` locally to confirm a change.
- Treat a local heap abort as a code failure, or "fix" it by narrowing the check to a
  subset and reporting that subset as if it were the whole gate.
- Reach for `--no-verify`: a deferring hook is the intended path, not an obstacle. If
  the hook cannot defer, fix the hook.
- Set a huge heap globally (`~/.npmrc`) and leave the next contributor's machine
  quietly over-committed.

### Must always on a low-memory host

- Verify locally only what stays small and still answers the question: the one test
  file you touched (`node --test tests/scripts/<name>.test.mjs`),
  `npm run lint:docs`, `npm run lint:markdown`, `npm run lint:skills`.
- Commit, push the branch, open the PR, and let the required contexts decide —
  `Automation policy passed` and `CI gate passed`, enforced by the `main merge gate`
  ruleset on every PR.
- Watch the run instead of repeating it:

  ```bash
  gh pr checks <number> --repo SquadRules/mcp --watch --fail-fast -i 10
  ```

  `--fail-fast` returns as soon as one check fails, so a red lane surfaces in seconds
  rather than after the full suite; `-i 10` polls every 10 s.
- Fix what CI reports, push, re-watch, and report delivery from the CI result on the
  head SHA — quote that SHA.
- State plainly which gates have not run. A local intention is not evidence.

### Why deferring is safe

The merge gate is enforced server-side, so a skipped local run cannot let an
unverified change land. CI tests the exact commit that would merge, on hardware with
the memory this host does not have, and its verdict is the one that counts.

That rests on a guarantee, not a hope: per
[ADR 0038](../../docs/adr/0038-lint-runs-for-every-change-class.md) the always-on
`CI gate passed` documentation lane runs the canonical aggregate `npm run lint`, so
every class — documentation-only, application, mixed, and the fail-closed unclassified
cases — executes ESLint in CI. `tests/scripts/workflow-structure.test.mjs` asserts that
aggregate. If the lane ever regresses to a subset of `lint:*` scripts, this rule's
premise breaks: fix the lane before deferring locally.
