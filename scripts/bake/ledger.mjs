/**
 * The step ledger: the only place a bake result becomes evidence.
 *
 * Two honesty constraints are structural here, not prose:
 *
 * 1. Every step carries exactly one status: `pass`, `fail`, `not-performed`
 *    (deliberately not run, with the reason and the manual steps) or `blocked` (a
 *    prerequisite is missing, with the reason). A non-`pass` row without a reason
 *    is a programming error and throws rather than producing unreadable evidence.
 * 2. `summarize()` never rounds up: an all-`pass` run is `pass`, any `fail` makes the
 *    run `fail`, and `not-performed`/`blocked` rows keep it `incomplete` so they can
 *    never be read as validation.
 */
const STATUS_SYMBOL = { pass: 'PASS', fail: 'FAIL', 'not-performed': 'SKIP', blocked: 'BLOCK' };

/** Every step recorded so far, in execution order. */
export const steps = [];

/** Manual follow-ups lifted from the steps that recorded them. */
export const manualSteps = [];

/** One evidence row. `detail.reason` is mandatory for every non-pass status. */
export function record(id, title, status, detail = {}) {
  if (status !== 'pass' && typeof detail.reason !== 'string') {
    throw new Error(`step ${id} needs a reason when it is ${status}`);
  }
  steps.push({ id, title, status, ...detail });
  const suffix = detail.reason ? ` — ${detail.reason}` : '';
  process.stdout.write(`[${STATUS_SYMBOL[status]}] ${id} ${title}${suffix}\n`);
  if (Array.isArray(detail.manual_steps)) manualSteps.push(...detail.manual_steps);
}

/**
 * Roll the ledger up into counts and the run status.
 *
 * `fail` dominates: a run that failed a step is not rescued by `--allow-blocked`, which
 * only speaks about deliberate skips.
 */
export function summarize() {
  const counts = steps.reduce((acc, step) => ({ ...acc, [step.status]: (acc[step.status] ?? 0) + 1 }), {});
  const failed = counts.fail ?? 0;
  const incomplete = (counts['not-performed'] ?? 0) + (counts.blocked ?? 0);
  const status = failed > 0 ? 'fail' : incomplete > 0 ? 'incomplete' : 'pass';
  return { counts, failed, incomplete, status };
}
