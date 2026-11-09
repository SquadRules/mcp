/**
 * Error type for the `train` write path (and the guards that run before it).
 *
 * Extracted from `train-store.ts` so the pre-write guards can raise the same error
 * type without importing the tool implementation (which would be a cycle).
 */
export class TrainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TrainError';
  }
}
