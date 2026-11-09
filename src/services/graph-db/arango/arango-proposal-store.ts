/**
 * ArangoDB evidence-gated evolution proposals and confirmations.
 *
 * A proposal is a record, never an edit: creating one leaves its target adapter
 * untouched. Promotion to `accepted` only authorizes a normal `train`/`tune` run
 * against the current version — the write path stays the validator-gated one.
 */
import type { ArangoHttpClient } from './arango-http.js';
import type {
  EvolutionProposalNode,
  ProposalConfirmation,
  ProposalFilter,
  ProposalStatus
} from '../graph-types.js';
import { confirmationFromDoc, proposalFromDoc, type ArangoDoc } from './arango-rows.js';

function proposalDoc(proposal: EvolutionProposalNode): ArangoDoc {
  const doc: ArangoDoc = {
    _key: proposal.key,
    type: 'proposal',
    target_key: proposal.target_key,
    target_slug: proposal.target_slug,
    space: proposal.space,
    change_type: proposal.change_type,
    field: proposal.field,
    from_value: proposal.from_value,
    to_value: proposal.to_value,
    reason: proposal.reason,
    source_child: proposal.source_child,
    evidence: proposal.evidence,
    evidence_digest: proposal.evidence_digest,
    status: proposal.status,
    created_at: proposal.created_at,
    created_by: proposal.created_by,
    actor_source: proposal.actor_source,
    required_confirmations: proposal.required_confirmations,
    metadata: proposal.metadata ?? {}
  };
  if (proposal.source_anomaly) doc['source_anomaly'] = proposal.source_anomaly;
  return doc;
}

/** Insert a proposal and link it to its target adapter when that node exists. */
export async function createProposal(
  client: ArangoHttpClient,
  proposal: EvolutionProposalNode
): Promise<void> {
  if (!proposal.space || proposal.space.trim().length === 0) {
    throw new Error('createProposal: space is required — a proposal never guesses a scope');
  }
  const doc = proposalDoc(proposal);
  await client.withTransaction(
    { write: ['Proposal', 'ProposedFor'], read: ['Adapter'] },
    async (transactionId) => {
      await client.queryInTransaction(transactionId, 'INSERT @doc INTO Proposal', { doc });
      await client.queryInTransaction(
        transactionId,
        `FOR a IN Adapter
           FILTER a._key == @targetKey
           LIMIT 1
           INSERT { _from: CONCAT('Proposal/', @proposalKey), _to: CONCAT('Adapter/', @targetKey),
                    relationship: 'proposed_for', created_at: @createdAt }
           INTO ProposedFor`,
        {
          proposalKey: proposal.key,
          targetKey: proposal.target_key,
          createdAt: proposal.created_at
        }
      );
    }
  );
}

export async function getProposal(
  client: ArangoHttpClient,
  proposalKey: string
): Promise<EvolutionProposalNode | null> {
  const rows = await client.query<ArangoDoc>(
    'FOR p IN Proposal FILTER p._key == @proposalKey LIMIT 1 RETURN p',
    { proposalKey }
  );
  return rows[0] ? proposalFromDoc(rows[0]) : null;
}

/** Proposals filtered by target, space, status, or reporting child. */
export async function listProposals(
  client: ArangoHttpClient,
  filter: ProposalFilter = {}
): Promise<EvolutionProposalNode[]> {
  const rows = await client.query<ArangoDoc>(
    `FOR p IN Proposal
       FILTER @targetKey == '' OR p.target_key == @targetKey
       FILTER @space == '' OR p.space == @space
       FILTER @status == '' OR p.status == @status
       FILTER @sourceChild == '' OR p.source_child == @sourceChild
       SORT p.created_at DESC
       LIMIT @limit
       RETURN p`,
    {
      targetKey: filter.targetKey ?? '',
      space: filter.space ?? '',
      status: filter.status ?? '',
      sourceChild: filter.sourceChild ?? '',
      limit: filter.limit && filter.limit > 0 ? filter.limit : 200
    }
  );
  return rows.map(proposalFromDoc);
}

/** Move a proposal to a new status. Status transitions never touch the adapter. */
export async function updateProposalStatus(
  client: ArangoHttpClient,
  proposalKey: string,
  status: ProposalStatus,
  metadata?: Record<string, unknown>
): Promise<void> {
  await client.query(
    `FOR p IN Proposal
       FILTER p._key == @proposalKey
       UPDATE p WITH { status: @status, metadata: @metadata } IN Proposal`,
    { proposalKey, status, metadata: metadata ?? {} }
  );
}

/**
 * Append one confirmation.
 *
 * The caller supplies a deterministic `key` (proposal + actor) so a repeated
 * confirmation from the same identity upserts nothing new — duplicate confirmers
 * cannot manufacture quorum.
 */
export async function recordConfirmation(
  client: ArangoHttpClient,
  confirmation: ProposalConfirmation
): Promise<void> {
  const doc: ArangoDoc = {
    _key: confirmation.key,
    type: 'confirmation',
    proposal_key: confirmation.proposal_key,
    actor: confirmation.actor,
    actor_kind: confirmation.actor_kind,
    actor_source: confirmation.actor_source,
    decision: confirmation.decision,
    created_at: confirmation.created_at
  };
  if (confirmation.distinct_child) doc['distinct_child'] = confirmation.distinct_child;
  if (confirmation.evidence) doc['evidence'] = confirmation.evidence;

  await client.query('INSERT @doc INTO Confirmation OPTIONS { overwriteMode: "ignore" }', {
    doc
  });
}

export async function listConfirmations(
  client: ArangoHttpClient,
  proposalKey: string
): Promise<ProposalConfirmation[]> {
  const rows = await client.query<ArangoDoc>(
    `FOR c IN Confirmation
       FILTER c.proposal_key == @proposalKey
       SORT c.created_at ASC
       LIMIT 1000
       RETURN c`,
    { proposalKey }
  );
  return rows.map(confirmationFromDoc);
}
