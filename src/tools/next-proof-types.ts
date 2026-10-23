import type { ProofOfWorkType } from '../types/memory.js';

export type ProofOfWorkSubmission = {
  type: ProofOfWorkType;
  nonce?: string;
  proof_hash?: string;
  /** @deprecated Use proof_hash. Kept for older persisted payloads. */
  previousProofHash?: string;
  shell?: {
    exit_code: number;
    stdout?: string;
    stderr?: string;
    duration_seconds?: number;
  };
  forward?: {
    target: string;
    success: boolean;
  };
  user_input?: {
    confirmation: string;
    timestamp?: string;
  };
  comment?: {
    text: string;
  };
  subagent?: {
    report: string;
  };
};

export type BuildChallengeOptions = {
  existingNonce?: string;
};

export type ElicitResult = { solution: ProofOfWorkSubmission } | { payload: any };

export type HandleProofOptions = {
  /** Expected proof_hash: GENESIS_HASH for step 1, or stored hash of previous step's proof. */
  expectedPreviousHash: string;
};

export type HandleProofResult = { blockedPayload?: any; proofHash?: string; alreadyRecorded?: boolean };
