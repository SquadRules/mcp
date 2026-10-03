/**
 * Shared review_evidence validation for train and tune.
 * Extracted to keep per-file line counts within ESLint max-lines.
 */
import { TrainError } from './train-store.js';

export interface ReviewEvidence {
  verdict_file: string;
  exit_code: number;
  stdout: string;
}

/**
 * Assert that review_evidence proves a PASS verdict from phase-critic.
 * Throws TrainError on any failure so that the train error pipeline
 * formats the response correctly.
 */
export function assertReviewEvidencePassed(evidence: ReviewEvidence | undefined): void {
  if (!evidence) {
    throw new TrainError(
      'REVIEW_EVIDENCE_REQUIRED',
      'Adapter train requires review_evidence: run phase-critic first and provide the verdict file as proof.',
      { must_obey: true, next_action: 'call forward with squadrules://adapter/phase-critic to run the phase-critic review' }
    );
  }
  if (evidence.exit_code !== 0) {
    throw new TrainError(
      'REVIEW_GATE_FAILED',
      `Phase-critic review gate failed: exit_code ${evidence.exit_code} (expected 0). The adapter did not pass review.`,
      { must_obey: true, next_action: 'address phase-critic findings and re-invoke the review' }
    );
  }
  const firstLine = evidence.stdout.split(/\r?\n/)[0]?.trim() ?? '';
  if (!/^PASS$/i.test(firstLine)) {
    throw new TrainError(
      'REVIEW_GATE_FAILED',
      `Phase-critic review gate failed: verdict is "${firstLine}" (expected PASS). The adapter did not pass review.`,
      { must_obey: true, next_action: 'address phase-critic findings and re-invoke the review' }
    );
  }
}
