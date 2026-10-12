/**
 * Mock critic-loop review evidence for integration tests.
 *
 * Integration tests that call `train` with markdown content must provide
 * `review_evidence` because the schema requires it for adapter trains.
 * In test context we supply a synthetic PASS verdict — no real critic-loop
 * run is needed.
 */
export const MOCK_REVIEW_EVIDENCE = {
  verdict_file: '/tmp/test-critic-loop-verdict.txt',
  exit_code: 0,
  stdout: 'PASS'
} as const;
