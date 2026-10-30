/**
 * Error payload for a failed proof step. Kept in its own module so the proof
 * helpers stay within the file-size gate.
 */
import type { Memory } from '../types/memory.js';
import { SQUADRULES_LOCAL_ARTIFACT_DIRS } from '../config.js';
import { MAX_RETRIES } from '../services/proof-of-work-store.js';
import { buildLocalArtifactDirFields } from './local-artifact-dir-contract.js';
import { buildLayerUri } from './squadrules-uri.js';

export function buildErrorPayload(
  memory: Memory | null,
  current_step: unknown,
  challenge: unknown,
  message: string,
  errorCode: string,
  retryCount: number,
  recovery?: string
): Record<string, unknown> {
  const uuid = memory?.memory_uuid;
  const uri = uuid ? buildLayerUri(uuid) : '';
  const maxExceeded = retryCount >= MAX_RETRIES;

  const payload: Record<string, unknown> = {
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
    payload['next_action'] = `Options: (1) call tune with uris ["${uri}"] and content or updates to fix the step for future executions (2) call reward with ${uri} and outcome failure and feedback to abort (3) ask the user for help`;
  } else if (uri) {
    payload['next_action'] = recovery
      ? `${recovery} Then retry forward with ${uri} -- use nonce and proof_hash from THIS response's contract`
      : `retry forward with ${uri} -- use nonce and proof_hash from THIS response's contract`;
  }

  return payload;
}
