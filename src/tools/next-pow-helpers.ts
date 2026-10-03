import crypto from 'node:crypto';
import type { Memory, ProofOfWorkDefinition, ProofOfWorkType } from '../types/memory.js';
import { proofOfWorkStore, MAX_RETRIES, type ProofOfWorkResultRecord } from '../services/proof-of-work-store.js';
import { embeddingService } from '../services/embedding/service.js';
import { getInferenceContract } from '../services/memory/memory-accessors.js';
import { COMMENT_SEMANTIC_VALIDATION_TIMEOUT_MS, SQUADRULES_LOCAL_ARTIFACT_DIRS } from '../config.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { structuredLogger } from '../utils/structured-logger.js';
import type {
  BuildChallengeOptions,
  ElicitResult,
  HandleProofOptions,
  HandleProofResult,
  ProofOfWorkSubmission
} from './next-proof-types.js';
import { validateMcpSubmissionAgainstContract } from './mcp-contract-match.js';
import { buildLayerUri } from './squadrules-uri.js';
import { buildChallengeShapeForDisplay } from './next-pow-challenge-shape.js';
import { buildLocalArtifactDirFields } from './local-artifact-dir-contract.js';
export type {
  BuildChallengeOptions,
  ElicitResult,
  HandleProofOptions,
  HandleProofResult,
  ProofOfWorkSubmission
} from './next-proof-types.js';

export { buildChallengeShapeForDisplay } from './next-pow-challenge-shape.js';
export { GENESIS_HASH } from './squadrules-genesis-proof-hash.js';

const COMMENT_SEMANTIC_THRESHOLD = 0.25;

function hashProofRecord(record: ProofOfWorkResultRecord): string {
  const canonical = JSON.stringify(record, Object.keys(record).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function buildChallenge(
  memory: Memory | null,
  proof?: ProofOfWorkDefinition,
  options?: BuildChallengeOptions
): Promise<any> {
  const base = buildChallengeShapeForDisplay(proof) as any;
  if (memory?.memory_uuid) {
    if (options?.existingNonce != null) {
      base.nonce = options.existingNonce;
      // Refresh TTL so repeated forward previews (no solution) do not expire the active challenge.
      await proofOfWorkStore.setNonce(memory.memory_uuid, options.existingNonce);
    } else {
      const nonce = crypto.randomBytes(16).toString('hex');
      await proofOfWorkStore.setNonce(memory.memory_uuid, nonce);
      base.nonce = nonce;
    }
  }
  return base;
}

export async function tryUserInputElicitation(
  server: any,
  memory: Memory,
  solution: ProofOfWorkSubmission,
  requestedUri: string,
  buildCurrentStep: (memory: Memory, uri: string) => any
): Promise<ElicitResult> {
  const contract = getInferenceContract(memory);
  if (contract?.type !== 'user_input' || solution?.user_input?.confirmation) {
    return { solution };
  }
  const lowLevel = (server as {
    server?: {
      getClientCapabilities?: () => { elicitation?: unknown };
      elicitInput?: (params: unknown) => Promise<{ action: string; content?: { confirmation?: string } }>;
    };
  }).server;
  const caps = lowLevel?.getClientCapabilities?.();
  if (caps?.elicitation == null || typeof lowLevel?.elicitInput !== 'function') {
    return { solution };
  }
  const prompt = contract.user_input?.prompt || 'Confirm completion';
  try {
    const elicitResult = await lowLevel.elicitInput({
      message: prompt,
      requestedSchema: {
        type: 'object',
        properties: { confirmation: { type: 'string', enum: ['approved', 'rejected'], description: 'Confirm or reject' } },
        required: ['confirmation']
      }
    });
    if (elicitResult?.action === 'accept' && elicitResult?.content?.confirmation) {
      return {
        solution: {
          ...solution,
          type: 'user_input',
          user_input: {
            confirmation: elicitResult.content.confirmation,
            timestamp: new Date().toISOString()
          }
        }
      };
    }
    const challenge = await buildChallenge(memory, contract);
    const current_step = buildCurrentStep(memory, requestedUri);
    if (elicitResult?.action === 'decline') {
      return { payload: buildErrorPayload(memory, current_step, challenge, 'User declined confirmation.', 'USER_DECLINED', 1) };
    }
    return { payload: buildErrorPayload(memory, current_step, challenge, 'User cancelled or did not confirm.', 'USER_DECLINED', 1) };
  } catch (error) {
    const challenge = await buildChallenge(memory, contract);
    return {
      payload: buildErrorPayload(
        memory,
        buildCurrentStep(memory, requestedUri),
        challenge,
        error instanceof Error ? error.message : 'Elicitation failed.',
        'ELICITATION_FAILED',
        1
      )
    };
  }
}

function buildErrorPayload(
  memory: Memory | null,
  current_step: any,
  challenge: any,
  message: string,
  errorCode: string,
  retryCount: number
): any {
  const uuid = memory?.memory_uuid;
  const uri = uuid ? buildLayerUri(uuid) : '';
  const maxExceeded = retryCount >= MAX_RETRIES;

  const payload: any = {
    must_obey: !maxExceeded,
    current_step,
    challenge,
    ...buildLocalArtifactDirFields(SQUADRULES_LOCAL_ARTIFACT_DIRS),
    message: maxExceeded
      ? `Step failed ${retryCount} times. Use your judgment to recover.`
      : message,
    error_code: maxExceeded ? 'MAX_RETRIES_EXCEEDED' : errorCode,
    retry_count: retryCount
  };

  if (maxExceeded && uri) {
    payload.next_action = `Options: (1) call tune with uris ["${uri}"] and content or updates to fix the step for future executions (2) call reward with ${uri} and outcome failure and feedback to abort (3) ask the user for help`;
  } else if (uri) {
    payload.next_action = `retry forward with ${uri} -- use nonce and proof_hash from THIS response's contract`;
  }

  return payload;
}

export async function handleProofSubmission(
  submission: ProofOfWorkSubmission,
  memory: Memory,
  options?: HandleProofOptions
): Promise<HandleProofResult> {
  const proof = getInferenceContract(memory);
  if (!proof) {
    return {};
  }

  const uuid = memory.memory_uuid;
  const proofType: ProofOfWorkType = submission.type;
  const requiredTypeRaw = proof.type;

  const submittedProofHash = submission.proof_hash ?? submission.previousProofHash;

  const blocked = async (msg: string, code: string, currentStep?: any, challengeObj?: any) => {
    const storedNonce = await proofOfWorkStore.getNonce(memory.memory_uuid);
    const retryKey = storedNonce ?? uuid;
    const retryCount = await proofOfWorkStore.incrementRetry(retryKey);
    const current = currentStep || { uri: buildLayerUri(uuid), content: '', mimeType: 'text/markdown' };
    let challengePayload =
      challengeObj ||
      (storedNonce != null
        ? await buildChallenge(memory, proof, { existingNonce: storedNonce })
        : await buildChallenge(memory, proof));
    if (options?.expectedPreviousHash != null) {
      challengePayload = { ...challengePayload, proof_hash: options.expectedPreviousHash };
    }
    return {
      blockedPayload: buildErrorPayload(memory, current, challengePayload, msg, code, retryCount)
    };
  };

  if (requiredTypeRaw === 'tensor') {
    return blocked('Tensor contracts must be handled by the forward runtime.', 'INVALID_PROOF_TYPE');
  }
  const requiredType: ProofOfWorkType = requiredTypeRaw ?? 'shell';
  if (memory.memory_uuid) {
    const storedNonce = await proofOfWorkStore.getNonce(memory.memory_uuid);
    if (storedNonce != null && submission.nonce !== storedNonce) {
      structuredLogger.getPinoLogger().info(
        { event: 'pow_nonce_mismatch', memory_uuid: memory.memory_uuid, submitted_nonce: submission.nonce ?? null, stored_nonce: storedNonce },
        'pow: submitted nonce does not match store — rotating nonce for recovery'
      );
      // Rotate nonce so the error response carries a fresh challenge.
      // Without rotation the response echoes the same stale nonce the agent
      // already tried, creating an unrecoverable NONCE_MISMATCH loop.
      const freshNonce = crypto.randomBytes(16).toString('hex');
      await proofOfWorkStore.setNonce(memory.memory_uuid, freshNonce);
      return blocked('Nonce mismatch. A fresh nonce has been issued — use the nonce from THIS response.', 'NONCE_MISMATCH');
    }
  }

  if (options?.expectedPreviousHash != null && submittedProofHash !== undefined) {
    if (submittedProofHash !== options.expectedPreviousHash) {
      return blocked('proof_hash mismatch. Use proof_hash from the previous response or current contract.', 'PROOF_HASH_MISMATCH');
    }
  }
  if (options?.expectedPreviousHash != null && submittedProofHash === undefined) {
    return blocked('Include proof_hash in solution (use contract.proof_hash for step 1).', 'MISSING_FIELD');
  }

  if (proofType !== requiredType && requiredType !== undefined) {
    return blocked(`Expected proof type: ${requiredType}, got: ${proofType}`, 'TYPE_MISMATCH');
  }

  const record: ProofOfWorkResultRecord = {
    result_id: `pow_${uuid}_${Date.now()}`,
    type: proofType,
    status: 'success',
    executed_at: new Date().toISOString()
  };

  if (proofType === 'shell') {
    const shell = submission.shell;
    if (!shell) {
      return blocked('Shell proof requires shell field with exit_code', 'MISSING_FIELD');
    }
    record.status = shell.exit_code === 0 ? 'success' : 'failed';
    record.shell = {
      exit_code: shell.exit_code,
      ...(shell.stdout !== undefined && { stdout: shell.stdout }),
      ...(shell.stderr !== undefined && { stderr: shell.stderr }),
      ...(shell.duration_seconds !== undefined && { duration_seconds: shell.duration_seconds })
    };
    record.exit_code = shell.exit_code;
    if (shell.stdout !== undefined) record.stdout = shell.stdout;
    if (shell.stderr !== undefined) record.stderr = shell.stderr;
    if (shell.duration_seconds !== undefined) record.duration_seconds = shell.duration_seconds;
  } else if (proofType === 'mcp') {
    const mcp = submission.mcp;
    if (!mcp) {
      return blocked('MCP proof requires mcp field', 'MISSING_FIELD');
    }
    const mcpContractCheck = validateMcpSubmissionAgainstContract(proof, mcp);
    if (!mcpContractCheck.ok) {
      return blocked(mcpContractCheck.message, mcpContractCheck.code);
    }
    record.status = mcp.success ? 'success' : 'failed';
    record.mcp = {
      tool_name: mcp.tool_name,
      arguments: mcp.arguments,
      result: mcp.result,
      success: mcp.success
    };
  } else if (proofType === 'user_input') {
    const userInput = submission.user_input;
    if (!userInput || !userInput.confirmation) {
      return blocked('User input proof requires user_input.confirmation', 'MISSING_FIELD');
    }
    record.status = 'success';
    record.user_input = {
      confirmation: userInput.confirmation,
      timestamp: userInput.timestamp || new Date().toISOString()
    };
  } else if (proofType === 'comment') {
    const comment = submission.comment;
    if (!comment || !comment.text) {
      return blocked('Comment proof requires evidence.text — include your verification summary in solution.evidence.text', 'MISSING_FIELD');
    }
    const minLength = proof.comment?.min_length || 10;
    if (comment.text.length < minLength) {
      return blocked(`Comment must be at least ${minLength} characters`, 'COMMENT_TOO_SHORT');
    }
    const stepContent = extractMemoryBody(memory.text) || String(memory.label || '').trim();
    const semanticMs = COMMENT_SEMANTIC_VALIDATION_TIMEOUT_MS;
    if (semanticMs > 0 && stepContent.length >= 20) {
      try {
        const embedBoth = Promise.all([
          embeddingService.generateEmbedding(comment.text.trim()),
          embeddingService.generateEmbedding(stepContent.slice(0, 8000))
        ]);
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('COMMENT_SEMANTIC_TIMEOUT')), semanticMs);
        });
        const [commentEmb, stepEmb] = await Promise.race([embedBoth, timeout]);
        const similarity = embeddingService.calculateCosineSimilarity(commentEmb.embedding, stepEmb.embedding);
        if (similarity < COMMENT_SEMANTIC_THRESHOLD) {
          return blocked(
            `Comment does not appear relevant to this step (similarity ${similarity.toFixed(2)} < ${COMMENT_SEMANTIC_THRESHOLD}). Provide a response that engages with the step content.`,
            'COMMENT_IRRELEVANT'
          );
        }
      } catch {
        // Fail open: embedding error, timeout, or provider slow — allow length-valid comments
      }
    }
    record.status = 'success';
    record.comment = { text: comment.text };
  }

  const existing = await proofOfWorkStore.getResult(uuid);
  if (existing?.status === 'success') {
    const proofHash = await proofOfWorkStore.getProofHash(uuid);
    return proofHash ? { proofHash, alreadyRecorded: true } : { proofHash: hashProofRecord(record) };
  }

  await proofOfWorkStore.saveResult(uuid, record);
  const proofHash = hashProofRecord(record);
  await proofOfWorkStore.setProofHash(uuid, proofHash);

  if (proof.required && record.status === 'failed') {
    return blocked('Proof of work failed. Fix and retry.', 'COMMAND_FAILED');
  }

  const storedNonce = await proofOfWorkStore.getNonce(memory.memory_uuid);
  const retryKey = storedNonce ?? uuid;
  await proofOfWorkStore.resetRetry(retryKey);

  return { proofHash };
}
