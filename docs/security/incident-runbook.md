# Incident response runbook

This runbook explains how you investigate and contain security incidents in
SquadRules MCP. It focuses on request-level traceability, embedding abuse, and
cross-tenant isolation risks.

## Scope and required inputs

You must start each investigation with enough context to trace one request end
to end.

- `request_id` from logs, client reports, or monitoring alerts.
- Time window in UTC.
- Tenant or space identifier when available.
- Suspected operation such as `train`, `activate`, `forward`, `reward`, or `tune`.

## Severity and ownership

You must classify severity before deep analysis so escalation is predictable.

- **sev-1**: confirmed data leakage, active credential compromise, or production
  outage affecting multiple tenants.
- **sev-2**: confirmed anomalous behavior with no confirmed leakage.
- **sev-3**: suspicious signals that need follow-up but no confirmed impact.

The on-call engineer owns initial triage. Security review joins sev-1 and sev-2
incidents immediately.

## Investigation workflow

Use this sequence to keep evidence collection consistent and auditable.

1. **Collect entry evidence.** Capture alert payloads, `request_id`, user
   reports, and current service health.
2. **Trace request flow.** Query structured logs and audit logs by `request_id`
   and time window.
3. **Confirm tenant boundaries.** Verify `tenant_id`, `space_id`, and auth
   context in all related events.
4. **Inspect write operations.** Validate `created_by`, `modified_by`,
   `created_at`, and `modified_at` for affected memories.
5. **Assess blast radius.** Identify all impacted spaces, users, and tools.
6. **Contain.** Revoke compromised credentials, disable risky paths, and block
   abuse patterns.
7. **Recover and verify.** Confirm the system returns to expected behavior and
   run focused regression tests.

## Log query examples

Use commands like these to locate and correlate events quickly.

```bash
jq 'select(.request_id == "req-123")' var/log/kairos.log
```

```bash
jq 'select(.category == "audit.embedding" and .tenant_id == "group:kairos-dev:ops")' var/log/kairos.log
```

```bash
jq 'select(.category == "audit.anomaly" and .severity == "error")' var/log/kairos.log
```

If `AUDIT_LOG_FILE` is configured, run the same filters against that file to
use the append-only audit stream.

## Common incident playbooks

Use these focused procedures for known high-risk patterns.

### Data poisoning suspicion

Data poisoning incidents usually start with low-quality search results or
unexpected adapter behavior.

1. Query `audit.anomaly` events for `embedding_unusual_norm`,
   `search_low_score`, and `search_zero_results`.
2. Identify affected memory IDs and compare `modified_by` with expected actors.
3. Re-run targeted searches in the affected spaces to confirm behavior.
4. Quarantine suspicious memories and re-ingest trusted source material.

### Embedding API abuse or key compromise

Embedding abuse incidents often show sudden spikes in latency, volume, or
cross-tenant patterns.

1. Filter `audit.embedding` events by provider and tenant.
2. Identify unusual request rates, input sizes, and error bursts.
3. Rotate API keys and enforce short-term rate limits.
4. Validate post-rotation traffic returns to baseline.

### Cross-tenant access suspicion

Cross-tenant suspicion requires immediate containment and strict evidence
preservation.

1. Correlate request logs, audit logs, and tool responses by `request_id`.
2. Verify `space_id` filters and tenant mapping for all touched records.
3. Confirm no unauthorized content appears in `export` or search responses.
4. Escalate to sev-1 if leakage is confirmed.

## Communications and closure

Every sev-1 and sev-2 incident must produce a short written summary with:

- Timeline of detection, containment, and recovery.
- Root cause with code path or configuration reference.
- Customer impact and evidence of containment.
- Action items with owners and due dates.

## Next steps

After incident closure, you must update tests and controls so the same class of
incident is detected earlier or prevented entirely.

