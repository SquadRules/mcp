/**
 * Step-engine input/output schemas used by the forward runtime.
 * V2: removed next_step, protocol_status, attest_required, final_challenge.
 * Renamed genesis_hash -> proof_hash, previousProofHash -> proof_hash, last_proof_hash -> proof_hash.
 * Added error_code and retry_count for two-phase retry escalation.
 */
import { z } from 'zod';

const layerUriSchema = z
  .string()
  .regex(
    /^squadrules:\/\/layer\/[0-9a-f-]{36}(?:\?execution_id=[0-9a-f-]{36})?$/i,
    'must match squadrules://layer/{uuid}[?execution_id={uuid}]'
  );

export const solutionSchema = z.object({
  type: z.enum(['shell', 'mcp', 'user_input', 'comment']).describe('Must match challenge.type'),
  nonce: z.string().optional().describe('Echo nonce from challenge'),
  proof_hash: z.string().optional().describe('Echo proof_hash from previous challenge or response'),
  shell: z.object({
    exit_code: z.number(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    duration_seconds: z.number().optional()
  }).optional(),
  mcp: z.object({
    tool_name: z.string(),
    arguments: z.any().optional(),
    result: z.any(),
    success: z.boolean()
  }).optional(),
  user_input: z.object({
    confirmation: z.string(),
    timestamp: z.string().optional()
  }).optional(),
  comment: z.object({ text: z.string() }).optional()
}).refine(
  (data) => !!(data.shell || data.mcp || data.user_input || data.comment),
  { message: 'At least one type-specific field (shell, mcp, user_input, or comment) must be provided' }
).refine(
  (data) => {
    if (data.type === 'shell' && !data.shell) return false;
    if (data.type === 'mcp' && !data.mcp) return false;
    if (data.type === 'user_input' && !data.user_input) return false;
    if (data.type === 'comment' && !data.comment) return false;
    return true;
  },
  { message: 'The type-specific field must match the solution type' }
);

export const challengeSchema = z.object({
  type: z.enum(['shell', 'mcp', 'user_input', 'comment']),
  description: z.string(),
  nonce: z.string().optional().describe('Echo back as solution.nonce'),
  proof_hash: z.string().optional().describe('Echo back as solution.proof_hash'),
  shell: z.object({
    cmd: z.string(),
    timeout_seconds: z.number(),
    interpreter: z.string().optional(),
    flags: z.array(z.string()).optional(),
    args: z.array(z.string()).optional(),
    workdir: z.string().optional(),
    /** Server-computed display line for agents/UI. */
    invocation_display: z.string().optional()
  }).optional(),
  mcp: z.object({
    tool_name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    expected_result: z.any().optional()
  }).optional(),
  user_input: z.object({
    prompt: z.string().optional()
  }).optional(),
  comment: z.object({
    min_length: z.number().optional()
  }).optional()
});

export const nextInputSchema = z.object({
  uri: layerUriSchema.describe('Current layer URI (from next_action of previous response)'),
  solution: solutionSchema.describe('Proof matching challenge.type: shell/mcp/user_input/comment')
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
