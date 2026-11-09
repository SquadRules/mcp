/**
 * LadybugDB evidence-gated evolution proposals and confirmations.
 *
 * A proposal is a *record*, never an edit: creating one leaves its target adapter
 * untouched. Promotion to `accepted` only authorizes a normal `train`/`tune` run
 * against the current version — the write path stays the validator-gated one
 * (docs/specs/ontological-knowledge-system.md, "Anomaly detection and resolution").
 */
import type { Connection } from '@ladybugdb/core';
import type {
  EvolutionProposalNode,
  ProposalConfirmation,
  ProposalFilter,
  ProposalStatus
} from '../graph-types.js';
import { executeStatement, parseJson, readRows } from './ladybug-exec.js';

const PROPOSAL_COLUMNS = `p.key as key, p.type as type, p.target_key as target_key,
  p.target_slug as target_slug, p.space as space, p.change_type as change_type,
  p.field as field, p.from_value as from_value, p.to_value as to_value,
  p.reason as reason, p.source_child as source_child, p.source_anomaly as source_anomaly,
  p.evidence as evidence, p.evidence_digest as evidence_digest, p.status as status,
  p.created_at as created_at, p.created_by as created_by, p.actor_source as actor_source,
  p.required_confirmations as required_confirmations, p.metadata as metadata`;

const CONFIRMATION_COLUMNS = `c.key as key, c.type as type, c.proposal_key as proposal_key,
  c.actor as actor, c.actor_kind as actor_kind, c.actor_source as actor_source,
  c.distinct_child as distinct_child, c.decision as decision,
  c.evidence as evidence, c.created_at as created_at`;

function toProposalNode(row: Record<string, unknown>): EvolutionProposalNode {
  const node: EvolutionProposalNode = {
    key: String(row['key'] ?? ''),
    type: 'proposal',
    target_key: String(row['target_key'] ?? ''),
    target_slug: String(row['target_slug'] ?? ''),
    space: String(row['space'] ?? ''),
    change_type: String(row['change_type'] ?? 'parent_update') as EvolutionProposalNode['change_type'],
    field: String(row['field'] ?? ''),
    from_value:
      row['from_value'] === null || row['from_value'] === undefined
        ? null
        : String(row['from_value']),
    to_value: String(row['to_value'] ?? ''),
    reason: String(row['reason'] ?? ''),
    source_child: String(row['source_child'] ?? ''),
    evidence: parseJson<Record<string, unknown>>(row['evidence'], {}),
    evidence_digest: String(row['evidence_digest'] ?? ''),
    status: String(row['status'] ?? 'proposed') as ProposalStatus,
    created_at: String(row['created_at'] ?? ''),
    created_by: String(row['created_by'] ?? ''),
    actor_source: String(row['actor_source'] ?? ''),
    required_confirmations: Number(row['required_confirmations'] ?? 1),
    metadata: parseJson<Record<string, unknown>>(row['metadata'], {})
  };
  if (row['source_anomaly'] !== null && row['source_anomaly'] !== undefined) {
    node.source_anomaly = String(row['source_anomaly']);
  }
  return node;
}

function toConfirmation(row: Record<string, unknown>): ProposalConfirmation {
  const confirmation: ProposalConfirmation = {
    key: String(row['key'] ?? ''),
    type: 'confirmation',
    proposal_key: String(row['proposal_key'] ?? ''),
    actor: String(row['actor'] ?? ''),
    actor_kind: String(row['actor_kind'] ?? 'agent') as ProposalConfirmation['actor_kind'],
    actor_source: String(row['actor_source'] ?? ''),
    decision: String(row['decision'] ?? 'confirm') as ProposalConfirmation['decision'],
    created_at: String(row['created_at'] ?? '')
  };
  if (row['distinct_child'] !== null && row['distinct_child'] !== undefined) {
    confirmation.distinct_child = String(row['distinct_child']);
  }
  const evidence = parseJson<Record<string, unknown> | null>(row['evidence'], null);
  if (evidence) confirmation.evidence = evidence;
  return confirmation;
}

/** Insert a proposal. Insert-only so a retried reward cannot rewrite its claim. */
export async function createProposal(
  connection: Connection,
  proposal: EvolutionProposalNode
): Promise<void> {
  if (!proposal.space || proposal.space.trim().length === 0) {
    throw new Error('createProposal: space is required — a proposal never guesses a scope');
  }
  await executeStatement(
    connection,
    `CREATE (p:Proposal {
       key: $key, type: 'proposal', target_key: $targetKey, target_slug: $targetSlug,
       space: $space, change_type: $changeType, field: $field,
       from_value: $fromValue, to_value: $toValue, reason: $reason,
       source_child: $sourceChild, source_anomaly: $sourceAnomaly,
       evidence: $evidence, evidence_digest: $evidenceDigest, status: $status,
       created_at: $createdAt, created_by: $createdBy, actor_source: $actorSource,
       required_confirmations: $requiredConfirmations, metadata: $metadata
     })`,
    {
      key: proposal.key,
      targetKey: proposal.target_key,
      targetSlug: proposal.target_slug,
      space: proposal.space,
      changeType: proposal.change_type,
      field: proposal.field,
      fromValue: proposal.from_value,
      toValue: proposal.to_value,
      reason: proposal.reason,
      sourceChild: proposal.source_child,
      sourceAnomaly: proposal.source_anomaly ?? null,
      evidence: JSON.stringify(proposal.evidence ?? {}),
      evidenceDigest: proposal.evidence_digest,
      status: proposal.status,
      createdAt: proposal.created_at,
      createdBy: proposal.created_by,
      actorSource: proposal.actor_source,
      requiredConfirmations: proposal.required_confirmations,
      metadata: JSON.stringify(proposal.metadata ?? {})
    }
  );
}

export async function getProposal(
  connection: Connection,
  proposalKey: string
): Promise<EvolutionProposalNode | null> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (p:Proposal {key: $proposalKey}) RETURN ${PROPOSAL_COLUMNS} LIMIT 1`,
    { proposalKey }
  );
  return rows[0] ? toProposalNode(rows[0]) : null;
}

/** Proposals filtered by target, space, status, or reporting child. */
export async function listProposals(
  connection: Connection,
  filter: ProposalFilter = {}
): Promise<EvolutionProposalNode[]> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (p:Proposal)
     WHERE ($targetKey = '' OR p.target_key = $targetKey)
       AND ($space = '' OR p.space = $space)
       AND ($status = '' OR p.status = $status)
       AND ($sourceChild = '' OR p.source_child = $sourceChild)
     RETURN ${PROPOSAL_COLUMNS}
     ORDER BY p.created_at DESC
     LIMIT $limit`,
    {
      targetKey: filter.targetKey ?? '',
      space: filter.space ?? '',
      status: filter.status ?? '',
      sourceChild: filter.sourceChild ?? '',
      limit: filter.limit && filter.limit > 0 ? filter.limit : 200
    }
  );
  return rows.map(toProposalNode);
}

/** Move a proposal to a new status. Status transitions never touch the adapter. */
export async function updateProposalStatus(
  connection: Connection,
  proposalKey: string,
  status: ProposalStatus,
  metadata?: Record<string, unknown>
): Promise<void> {
  await executeStatement(
    connection,
    `MATCH (p:Proposal {key: $proposalKey})
     SET p.status = $status, p.metadata = $metadata`,
    {
      proposalKey,
      status,
      metadata: JSON.stringify(metadata ?? {})
    }
  );
}

/**
 * Append one confirmation, idempotently.
 *
 * The key is deterministic over `(proposal, actor, decision)`, so a repeated
 * confirmation from the same identity is the same vote. It must not raise: the
 * shared backend inserts with `overwriteMode: "ignore"`, and a duplicate that threw
 * here would make "duplicate confirmers cannot manufacture quorum" fail loudly
 * instead of counting once.
 */
export async function recordConfirmation(
  connection: Connection,
  confirmation: ProposalConfirmation
): Promise<void> {
  const existing = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (c:Confirmation {key: $key}) RETURN c.key as key LIMIT 1`,
    { key: confirmation.key }
  );
  if (existing.length > 0) return;

  const create = () => executeStatement(
    connection,
    `CREATE (c:Confirmation {
       key: $key, type: 'confirmation', proposal_key: $proposalKey,
       actor: $actor, actor_kind: $actorKind, actor_source: $actorSource,
       distinct_child: $distinctChild, decision: $decision,
       evidence: $evidence, created_at: $createdAt
     })`,
    {
      key: confirmation.key,
      proposalKey: confirmation.proposal_key,
      actor: confirmation.actor,
      actorKind: confirmation.actor_kind,
      actorSource: confirmation.actor_source,
      distinctChild: confirmation.distinct_child ?? null,
      decision: confirmation.decision,
      evidence: JSON.stringify(confirmation.evidence ?? null),
      createdAt: confirmation.created_at
    }
  );

  try {
    await create();
  } catch (err) {
    // A concurrent confirmer may have written the same deterministic key first.
    const raced = await readRows<Record<string, unknown>>(
      connection,
      `MATCH (c:Confirmation {key: $key}) RETURN c.key as key LIMIT 1`,
      { key: confirmation.key }
    );
    if (raced.length > 0) return;
    throw err;
  }
}

export async function listConfirmations(
  connection: Connection,
  proposalKey: string
): Promise<ProposalConfirmation[]> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (c:Confirmation {proposal_key: $proposalKey})
     RETURN ${CONFIRMATION_COLUMNS}
     ORDER BY c.created_at ASC
     LIMIT 1000`,
    { proposalKey }
  );
  return rows.map(toConfirmation);
}
