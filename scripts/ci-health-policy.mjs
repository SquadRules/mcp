// GitHub's best-effort cron can delay or drop several hourly schedule events.
// Preserve a firm outage limit without treating ordinary scheduler gaps as failed CI.
export const AUDIT_STALE_MINUTES = 12 * 60;

export function assessWorkflow(file, maxMinutes, runs, now = Date.now()) {
  const events = file === 'release.yml' ? ['push', 'workflow_dispatch'] : ['schedule'];
  const completed = runs.filter(run => run.status === 'completed' && events.includes(run.event))
    .sort((a, b) => b.id - a.id)[0];
  const age = completed ? now - Date.parse(completed.updated_at) : Infinity;
  const stale = maxMinutes !== null && (!Number.isFinite(age) || age > maxMinutes * 60_000);
  // A skipped run still proves the scheduled automation executed.
  const healthy = !!completed && ['success', 'skipped'].includes(completed.conclusion);
  return {
    completed,
    failed: stale || !healthy,
    reason: stale ? 'Scheduled automation is stale or missing' : 'Latest run: ' + completed?.conclusion,
  };
}
