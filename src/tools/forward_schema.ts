// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';
import { ADAPTER_SLUG_URI_INPUT_REGEX, LAYER_URI_INPUT_REGEX } from './kairos-uri.js';

const adapterUriSchema = z
  .string()
  .regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'must match kairos://adapter/{slug}');

const layerUriSchema = z
  .string()
  .regex(LAYER_URI_INPUT_REGEX, 'must match kairos://layer/{uuid}[?execution_id={uuid}]');

const forwardUriSchema = z.union([adapterUriSchema, layerUriSchema]);

const tensorOutputSchema = z.object({
  name: z.string(),
  type: z.string(),
  min_length: z.number().optional(),
  max_length: z.number().optional(),
  min_items: z.number().optional(),
  max_items: z.number().optional()
});

const tensorContractSchema = z.object({
  required_inputs: z.array(z.string()),
  output: tensorOutputSchema,
  merge: z.string().optional(),
  condition: z.string().optional()
});

export const forwardContractSchema = z.object({
  type: z.enum(['tensor', 'shell', 'mcp', 'user_input', 'comment']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  nonce: z.string().optional(),
  proof_hash: z.string().optional(),
  tensor: tensorContractSchema.optional(),
  shell: z.object({
    cmd: z.string(),
    timeout_seconds: z.number()
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

const solutionTypeSchema = z.enum(['tensor', 'shell', 'mcp', 'user_input', 'comment']);

const solutionTemplateSchema = z
  .object({
    type: solutionTypeSchema,
    outcome: z.enum(['success', 'failure', 'skipped']).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    tensor: z.record(z.string(), z.unknown()).optional(),
    shell: z.record(z.string(), z.unknown()).optional(),
    mcp: z.record(z.string(), z.unknown()).optional(),
    user_input: z.record(z.string(), z.unknown()).optional(),
    comment: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
  .superRefine((value: z.infer<typeof solutionTemplateSchema>, ctx: z.RefinementCtx) => {
    type PayloadField = 'tensor' | 'shell' | 'mcp' | 'user_input' | 'comment';
    const typeToField: Record<z.infer<typeof solutionTypeSchema>, PayloadField> = {
      tensor: 'tensor',
      shell: 'shell',
      mcp: 'mcp',
      user_input: 'user_input',
      comment: 'comment'
    };
    const expectedField = typeToField[value.type];
    const providedFields = (Object.keys(typeToField) as Array<PayloadField>).filter((typeKey) => {
      const field = typeToField[typeKey];
      return value[field] !== undefined;
    });
    if (value.evidence === undefined && !providedFields.includes(value.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `solution_template.${expectedField} is required for type "${value.type}".`
      });
      return;
    }
    if (providedFields.some((field) => field !== value.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'solution_template must include only the payload field matching solution_template.type.'
      });
    }
  });

const forwardNextCallSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('forward'),
    args: z
      .object({
        uri: layerUriSchema,
        solution_template: solutionTemplateSchema
      })
      .strict()
  }),
  z.object({
    kind: z.literal('reward'),
    args: z
      .object({
        uri: layerUriSchema,
        outcome_template: z
          .object({
            outcome: z.literal('success')
          })
          .strict()
      })
      .strict()
  })
]);
const forwardCommentSolutionCanonicalSchema = z.object({
  text: z.string()
});
function normalizeForwardSolutionCommentInput(raw: unknown): unknown {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const o = raw as Record<string, unknown>;
  const c = o['comment'];
  if (typeof c === 'string') {
    return { ...o, comment: { text: c } };
  }
  return raw;
}
function normalizeCommentTextToEvidence(solution: Record<string, unknown>): Record<string, unknown> | null {
  if (solution['type'] !== 'comment' || typeof solution['text'] !== 'string') return null;
  const existingEvidence =
    solution['evidence'] !== null && solution['evidence'] !== undefined && typeof solution['evidence'] === 'object' && !Array.isArray(solution['evidence'])
      ? (solution['evidence'] as Record<string, unknown>)
      : {};
  if (existingEvidence['text'] === undefined) {
    return { ...solution, evidence: { ...existingEvidence, text: solution['text'] } };
  }
  return null;
}
function normalizeForwardSolutionFormat(raw: unknown): unknown {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const solution = raw as Record<string, unknown>;
  const normalizedWithComment = normalizeForwardSolutionCommentInput(solution);
  if (normalizedWithComment !== solution) {
    return normalizeForwardSolutionFormat(normalizedWithComment);
  }

  // Normalize flat comment text into evidence.text when type=comment
  const withTextEvidence = normalizeCommentTextToEvidence(solution);
  if (withTextEvidence) return withTextEvidence;

  if (solution['evidence'] !== undefined && typeof solution['evidence'] === 'object') {
    const outcome = solution['outcome'];
    if (outcome === undefined) {
      return { ...solution, outcome: 'success' };
    }
    return solution;
  }
  const type = solution['type'];
  if (typeof type === 'string' && ['tensor', 'shell', 'mcp', 'user_input', 'comment'].includes(type)) {
    const typeSpecificData = solution[type];
    if (typeSpecificData !== undefined && typeof typeSpecificData === 'object') {
      const v2Solution: Record<string, unknown> = { type, outcome: 'success', evidence: typeSpecificData, nonce: solution['nonce'], proof_hash: solution['proof_hash'], trace: solution['trace'] };
      if (type === 'mcp' && (typeSpecificData as Record<string, unknown>)['result'] !== undefined) {
        const mcpData = typeSpecificData as Record<string, unknown>;
        const { result, ...rest } = mcpData;
        v2Solution['evidence'] = {
          ...rest,
          response: result
        };
      }

      return v2Solution;
    }
  }

  return solution;
}

const forwardSolutionShapeSchema = z.object({
  type: z.enum(['tensor', 'shell', 'mcp', 'user_input', 'comment']).describe('Must match contract.type on continuation calls'),
  outcome: z.enum(['success', 'failure', 'skipped']).optional().describe('Universal outcome signal. Required in v2 format.'),
  evidence: z.record(z.string(), z.unknown()).optional().describe('Type-specific proof of execution. Shape depends on solution.type.'),
  nonce: z.string().optional().describe('Echo nonce from contract for proof-based layers'),
  proof_hash: z.string().optional().describe('Echo proof_hash from previous layer when required'),
  tensor: z.object({
    name: z.string(),
    value: z.any()
  }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  shell: z.object({
    exit_code: z.number(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    duration_seconds: z.number().optional()
  }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  mcp: z.object({ tool_name: z.string(), arguments: z.any().optional(), result: z.any(), success: z.boolean() }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  user_input: z.object({ confirmation: z.string(), timestamp: z.string().optional() }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  comment: forwardCommentSolutionCanonicalSchema.optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  trace: z.string().optional().describe('Optional reasoning trace stored with the execution trace')
}).refine(
  (data: any) => !!(data.tensor || data.shell || data.mcp || data.user_input || data.comment || data.evidence),
  { message: 'At least one type-specific field must be provided' }
).refine(
  (data: any) => {
    if (data.type === 'tensor' && !data.tensor && !data.evidence) return false;
    if (data.type === 'shell' && !data.shell && !data.evidence) return false;
    if (data.type === 'mcp' && !data.mcp && !data.evidence) return false;
    if (data.type === 'user_input' && !data.user_input && !data.evidence) return false;
    if (data.type === 'comment' && !data.comment && !data.evidence) return false;
    return true;
  },
  { message: 'The type-specific field must match the solution type' }
);

export const forwardSolutionSchema = z.preprocess(
  normalizeForwardSolutionFormat,
  forwardSolutionShapeSchema
);

function isLayerUriWithExecutionId(uri: string): boolean {
  const match = uri.match(LAYER_URI_INPUT_REGEX);
  return Boolean(match?.[2]);
}

function isStartingNewForwardRun(uri: string): boolean {
  if (ADAPTER_SLUG_URI_INPUT_REGEX.test(uri)) {
    return true;
  }
  const match = uri.match(LAYER_URI_INPUT_REGEX);
  return Boolean(match?.[1] && !match[2]);
}

export const FORWARD_SOLUTION_FORBIDDEN_ON_START_MESSAGE =
  'Omit `solution` when starting a run (`kairos://adapter/...` or `kairos://layer/{uuid}` without `?execution_id=...`). The first call loads `contract`; then call `forward` again with the layer URI including `?execution_id=...` and a `solution` whose `type` matches `contract.type` (prefer v2: include `outcome` and `evidence`).';

export const forwardInputSchema = z.object({
  uri: forwardUriSchema.describe('Adapter or layer URI'),
  solution: forwardSolutionSchema
    .optional()
    .describe(
      'Layer solution. Required only when continuing a run (layer URI with `?execution_id=...`). Omit entirely on the first call (adapter URI or layer without `?execution_id=...`). For continuation calls, include solution.type, outcome, and evidence payload (older type-specific fields are still accepted), and echo nonce/proof_hash when present.'
    )
}).superRefine((data: z.infer<typeof forwardInputSchema>, ctx: z.RefinementCtx) => {
  if (isStartingNewForwardRun(data.uri) && data.solution !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['solution'],
      message: FORWARD_SOLUTION_FORBIDDEN_ON_START_MESSAGE
    });
  }
  if (isLayerUriWithExecutionId(data.uri) && !data.solution) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['solution'],
      message:
        '`solution` is required when continuing a run with `kairos://layer/...?execution_id=...`. Omit `solution` only on the first forward call of a run.'
    });
  }
});

const forwardWireSolutionShapeSchema = z.object({
  type: z
    .enum(['tensor', 'shell', 'mcp', 'user_input', 'comment'])
    .optional()
    .describe('Required for continuation calls; must match contract.type. Do not send `solution` at all on start calls.'),
  outcome: z.enum(['success', 'failure', 'skipped']).optional().describe('Universal outcome signal. Required in v2 format.'),
  evidence: z.record(z.string(), z.unknown()).optional().describe('Type-specific proof of execution. Shape depends on solution.type.'),
  nonce: z.string().optional(),
  proof_hash: z.string().optional(),
  tensor: z.object({
    name: z.string().optional(),
    value: z.any().optional()
  }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  shell: z.object({
    exit_code: z.number().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    duration_seconds: z.number().optional()
  }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  mcp: z.object({
    tool_name: z.string().optional(),
    arguments: z.any().optional(),
    result: z.any().optional(),
    success: z.boolean().optional()
  }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  user_input: z.object({
    confirmation: z.string().optional(),
    timestamp: z.string().optional()
  }).optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  comment: forwardCommentSolutionCanonicalSchema.optional().describe('Deprecated: Use \'evidence\' envelope instead. Still accepted.'),
  trace: z.string().optional()
}).passthrough();

const forwardWireSolutionSchema = z
  .preprocess(normalizeForwardSolutionFormat, forwardWireSolutionShapeSchema)
  .describe(
    'Start call (adapter URI or layer URI without `?execution_id=...`): omit `solution`. Continuation call (layer URI with `?execution_id=...`): include solution.type, outcome, evidence payload (older type-specific fields are still accepted), and echo nonce/proof_hash when present. Empty solution objects or missing solution.type will be rejected.'
  );

export const forwardMcpWireInputSchema = z
  .object({
    uri: z
      .string()
      .optional()
      .describe('Adapter or layer URI. Use adapter or layer without execution_id to start; use layer with execution_id to continue.'),
    solution: forwardWireSolutionSchema
      .optional()
      .describe('Only for continuation calls; omit on start. Must include solution.type and proof payload (prefer v2: outcome + evidence).')
  })
  .passthrough();

export const forwardOutputSchema = z.object({
  must_obey: z.boolean(),
  current_layer: z.object({ uri: layerUriSchema, content: z.string(), mimeType: z.literal('text/markdown') }).optional().nullable(),
  contract: forwardContractSchema,
  tensor_in: z.record(z.string(), z.unknown()).optional(),
  next_action: z.string(),
  proof_hash: z.string().optional(),
  execution_id: z.string().optional(),
  message: z.string().optional(),
  error_code: z.string().optional(),
  retry_count: z.number().optional(),
  slug_disambiguation_note: z.string().optional().describe('When forward started from a slug that matched multiple adapters, explains which was chosen'),
  next_call: forwardNextCallSchema,
  activation_space_name: z.string().optional(),
  context_adapter_name: z.string().optional(),
  current_layer_label: z.string().optional(),
  adapter_layer_index: z.number().int().positive().optional(),
  adapter_layer_count: z.number().int().positive().optional(),
  kairos_local_artifact_dir: z.array(z.string()).optional(),
  /** Compatibility alias for kairos_local_artifact_dir (same value). */
  squadrules_local_artifact_dir: z.array(z.string()).optional()
}).strict();

export type ForwardInput = z.infer<typeof forwardInputSchema>;
export type ForwardSolution = z.infer<typeof forwardSolutionSchema>;
export type ForwardOutput = z.infer<typeof forwardOutputSchema>;