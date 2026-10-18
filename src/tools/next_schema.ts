/**
 * Step-engine input/output schemas used by the forward runtime.
 * V2: removed next_step, protocol_status, attest_required, final_challenge.
 * Renamed genesis_hash -> proof_hash, previousProofHash -> proof_hash, last_proof_hash -> proof_hash.
 * Added error_code and retry_count for two-phase retry escalation.
 */
import { z } from 'zod';
import { SHELL_INTERPRETERS } from './shell-challenge-invocation.js';

const layerUriSchema = z
  .string()
  .regex(
    /^squadrules:\/\/layer\/[0-9a-f-]{36}(?:\?execution_id=[0-9a-f-]{36})?$/i,
    'must match squadrules://layer/{uuid}[?execution_id={uuid}]'
  );

export const solutionSchema = z.object({
  type: z.enum(['shell', 'user_input', 'comment', 'subagent']).describe('Must match challenge.type'),
  nonce: z.string().optional().describe('Echo nonce from challenge'),
  proof_hash: z.string().optional().describe('Echo proof_hash from previous challenge or response'),
  shell: z.object({
    exit_code: z.number(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    duration_seconds: z.number().optional()
  }).optional(),
  user_input: z.object({
    confirmation: z.string(),
    timestamp: z.string().optional()
  }).optional(),
  comment: z.object({ text: z.string() }).optional(),
  subagent: z.object({ report: z.string() }).optional()
}).refine(
  (data) => !!(data.shell || data.user_input || data.comment || data.subagent),
  { message: 'At least one type-specific field (shell, user_input, comment, or subagent) must be provided' }
).refine(
  (data) => {
    if (data.type === 'shell' && !data.shell) return false;
    if (data.type === 'user_input' && !data.user_input) return false;
    if (data.type === 'comment' && !data.comment) return false;
    if (data.type === 'subagent' && !data.subagent) return false;
    return true;
  },
  { message: 'The type-specific field must match the solution type' }
);

export const challengeSchema = z.object({
  type: z.enum(['shell', 'user_input', 'comment', 'subagent']),
  description: z.string(),
  nonce: z.string().optional().describe('Echo back as solution.nonce'),
  proof_hash: z.string().optional().describe('Echo back as solution.proof_hash'),
  shell: z.object({
    cmd: z.string(),
    timeout_seconds: z.number(),
    interpreter: z.enum(SHELL_INTERPRETERS).optional(),
    flags: z.array(z.string()).optional(),
    args: z.array(z.string()).optional(),
    workdir: z.string().optional(),
    /** Server-computed display line for agents/UI. */
    invocation_display: z.string().optional()
  }).optional(),
  user_input: z.object({
    prompt: z.string().optional()
  }).optional(),
  comment: z.object({
    min_length: z.number().optional()
  }).optional(),
  subagent: z.object({
    context: z.string().optional()
  }).optional()
});

export const nextInputSchema = z.object({
  uri: layerUriSchema.describe('Current layer URI (from next_action of previous response)'),
  solution: solutionSchema.describe('Proof matching challenge.type: shell/user_input/comment/subagent')
});

export const nextOutputSchema = z.object({
  must_obey: z.boolean().describe('true for success and recoverable errors, false after max retries'),
  current_step: z.object({
    uri: layerUriSchema,
    content: z.string(),
    mimeType: z.literal('text/markdown')
  }).optional().nullable(),
  challenge: challengeSchema,
  next_action: z.string().describe('Next tool call with embedded squadrules://layer/ URI'),
  proof_hash: z.string().optional().describe('Hash of proof just stored. Use as solution.proof_hash for next step.'),
  message: z.string().optional(),
  error_code: z.string().optional().describe('Machine-readable error code (e.g., NONCE_MISMATCH, MAX_RETRIES_EXCEEDED)'),
  retry_count: z.number().optional().describe('Number of retries on this step (present on error responses)'),
  retry_nonce: z.string().optional().describe('Convenience copy of challenge.nonce for NONCE_MISMATCH recovery; paste directly into solution.nonce.'),
  /**
   * Ordered URI hints (preferred first) for the run's local handoff dir. Resolve **on the client**:
   * `project://<rel>` → `<client project root>/<rel>`; `user://<rel>` → `<client home or $XDG_CONFIG_HOME>/<rel>`.
   * Use `project://` when you have exactly one project context; fall through to `user://` when your session
   * spans multiple projects. Export the resolved absolute path as `SQUADRULES_LOCAL_ARTIFACT_DIR` for shell
   * challenges. The server never resolves these to a path on its own filesystem.
   */
  squadrules_local_artifact_dir: z.array(z.string()).optional()
});

export { layerUriSchema };
