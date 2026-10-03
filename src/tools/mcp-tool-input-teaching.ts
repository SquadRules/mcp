import type { ZodError } from 'zod';
import { FORWARD_SOLUTION_FORBIDDEN_ON_START_MESSAGE } from './forward_schema.js';

export const MCP_INVALID_TOOL_INPUT = 'INVALID_TOOL_INPUT' as const;
const MAX_INPUT_RETRIES = 3;
const RETRY_TTL_MS = 60_000;
const retryCounters = new Map<string, { count: number; expiresAt: number }>();

export type SquadrulesToolNameForInputTeaching =
  | 'activate'
  | 'forward'
  | 'reward'
  | 'train'
  | 'tune'
  | 'delete'
  | 'export'
  | 'spaces';

function issuePaths(error: ZodError): string[] {
  return error.issues.map((i: any) => (i.path.length ? i.path.join('.') : '(root)'));
}

function hasTopLevelField(error: ZodError, field: string): boolean {
  return error.issues.some((i: any) => i.path[0] === field);
}

function readString(raw: unknown, keys: string[]): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function uriExecutionId(raw: unknown): string | null {
  const uri = readString(raw, ['uri']);
  if (!uri) return null;
  const match = uri.match(/^squadrules:\/\/layer\/[0-9a-f-]{36}\?execution_id=([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

function retryCounter(tool: SquadrulesToolNameForInputTeaching, raw: unknown): { retry_count: number; max_retries: number } {
  const executionId = uriExecutionId(raw);
  const scope =
    executionId ??
    readString(raw, ['X-Idempotency-Key', 'x-idempotency-key', 'idempotency_key']) ??
    readString(raw, ['transport_session_id', 'session_id']) ??
    readString(raw, ['origin_ip', 'ip']) ??
    'unknown';
  const key = `squadrules:retry:default:${tool}:${scope}`;
  const now = Date.now();
  const existing = retryCounters.get(key);
  const count = existing && existing.expiresAt > now ? existing.count + 1 : 1;
  retryCounters.set(key, { count, expiresAt: now + RETRY_TTL_MS });
  return { retry_count: count, max_retries: MAX_INPUT_RETRIES };
}

function withRetry(tool: SquadrulesToolNameForInputTeaching, raw: unknown, payload: Record<string, unknown>): Record<string, unknown> {
  const retry = retryCounter(tool, raw);
  const mustObey = retry.retry_count <= retry.max_retries;
  return {
    ...payload,
    must_obey: mustObey,
    ...(mustObey
      ? {}
      : {
          next_action:
            'Stop retrying this exact payload. Ask for clarification or call activate again to regenerate the next step.'
        }),
    ...retry
  };
}

function teachingActivate(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  const queryProblem = hasTopLevelField(error, 'query') || paths.some((p) => p.startsWith('query'));
  const message = queryProblem
    ? 'Input validation error: `activate` needs a non-empty `query` string summarizing the user intent (about 3–8 words is enough). Optional: `space` / `space_id` to narrow search; optional `max_choices` within the allowed range.'
    : 'Input validation error: Check `activate` arguments against the tool schema: required `query`; optional `space`, `space_id`, `max_choices`.';
  return withRetry('activate', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'activate',
    message,
    next_action:
      'Call activate again with {"query":"<short intent from the user message>"}. Use spaces first if you need allowed space names.',
    invalid_fields: paths,
    example: { query: 'review and publish adapter' }
  });
}

function teachingForward(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  const uriProblem = hasTopLevelField(error, 'uri');
  const solutionProblem = hasTopLevelField(error, 'solution') || paths.some((p) => p.startsWith('solution'));
  const forbiddenSolutionOnStart = error.issues.some(
    (i: any) => i.message === FORWARD_SOLUTION_FORBIDDEN_ON_START_MESSAGE
  );
  const missingSolutionType = error.issues.some(
    (issue: any) => issue.path.length === 2 && issue.path[0] === 'solution' && issue.path[1] === 'type'
  );
  const rawUri = readString(raw, ['uri']);
  const adapterUuidOnWire =
    typeof rawUri === 'string' && /^squadrules:\/\/adapter\/[0-9a-f-]{36}$/i.test(rawUri);
  const memUriMisuse = typeof rawUri === 'string' && /^squadrules:\/\/mem\//i.test(rawUri);

  if (uriProblem && adapterUuidOnWire) {
    return withRetry('forward', raw, {
      error: MCP_INVALID_TOOL_INPUT,
      tool: 'forward',
      message: 'Input validation error: Adapter URIs are slug-only on the wire for forward.',
      next_action:
        'Retry forward with {"uri":"squadrules://adapter/<slug>"} copied from activate `choices[].forward_first_call.uri`.',
      invalid_fields: paths,
      example: { uri: 'squadrules://adapter/phase-critic' }
    });
  }
  if (uriProblem && memUriMisuse) {
    return withRetry('forward', raw, {
      error: MCP_INVALID_TOOL_INPUT,
      tool: 'forward',
      message: 'Input validation error: memory URIs are for resource reads, not forward.',
      next_action:
        'Retry forward with an adapter slug URI for start calls or a layer URI with execution_id for continuation calls.',
      invalid_fields: paths,
      example: { uri: 'squadrules://adapter/phase-critic' }
    });
  }
  if (uriProblem) {
    return withRetry('forward', raw, {
      error: MCP_INVALID_TOOL_INPUT,
      tool: 'forward',
      message:
        'Input validation error: `uri` is required and must be a JSON string using squadrules://adapter/<slug> or squadrules://layer/<uuid>[?execution_id=<uuid>].',
      next_action:
        'Retry forward with {"uri":"squadrules://adapter/<slug>"} for start, or the exact layer URI from the previous forward response.',
      invalid_fields: paths,
      example: { uri: 'squadrules://adapter/phase-critic' }
    });
  }
  if (solutionProblem && forbiddenSolutionOnStart) {
    return withRetry('forward', raw, {
      error: MCP_INVALID_TOOL_INPUT,
      tool: 'forward',
      message: `Input validation error: ${FORWARD_SOLUTION_FORBIDDEN_ON_START_MESSAGE}`,
      next_action:
        'Retry forward with {"uri":"<adapter-slug-or-layer-uri-without-execution_id>"} only. Omit `solution` on start.',
      invalid_fields: paths,
      example: { uri: 'squadrules://adapter/phase-critic' }
    });
  }
  if (solutionProblem && missingSolutionType) {
    return withRetry('forward', raw, {
      error: MCP_INVALID_TOOL_INPUT,
      tool: 'forward',
      message:
        'Input validation error: `solution.type` is required on continuation calls and must match the current contract.type.',
      next_action:
        'Retry with the same layer URI including execution_id and provide solution.type plus evidence payload.',
      invalid_fields: paths,
      example: {
        uri: 'squadrules://layer/<uuid>?execution_id=<uuid>',
        solution: { type: 'comment', outcome: 'success', evidence: { text: 'done' } }
      }
    });
  }
  if (solutionProblem) {
    return withRetry('forward', raw, {
      error: MCP_INVALID_TOOL_INPUT,
      tool: 'forward',
      message:
        'Input validation error: `solution` must include type, outcome, and evidence payload.',
      next_action:
        'Retry with solution.type set to contract.type, outcome: "success", and evidence with required proof data.',
      invalid_fields: paths,
      example: {
        uri: 'squadrules://layer/<uuid>?execution_id=<uuid>',
        solution: { type: 'shell', outcome: 'success', evidence: { exit_code: 0 } }
      }
    });
  }
  return withRetry('forward', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'forward',
    message: 'Input validation error: Invalid arguments for tool forward.',
    next_action: 'Retry forward with valid JSON matching the schema.',
    invalid_fields: paths,
    example: { uri: 'squadrules://adapter/phase-critic' }
  });
}

function teachingReward(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  return withRetry('reward', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'reward',
    message:
      'Input validation error: `reward` needs `uri` = final layer URI from the last forward (`squadrules://layer/<uuid>` with `?execution_id=...` when the run used it), plus `outcome` ("success" or "failure"). Optional: score, feedback, rater, rubric_version (required for SFT/preference export), llm_model_id (required with rater for evaluator identity).',
    next_action:
      'Call reward with {"uri":"<layer uri from forward>","outcome":"success"|"failure","rubric_version":"v1","rater":"agent","llm_model_id":"<model>"} — copy the layer uri verbatim from the forward response that told you to reward.',
    invalid_fields: paths,
    example: { uri: 'squadrules://layer/<uuid>?execution_id=<uuid>', outcome: 'success' }
  });
}

function teachingTrain(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  const md = hasTopLevelField(error, 'content') || hasTopLevelField(error, 'source_adapter_uri');
  const model = hasTopLevelField(error, 'llm_model_id');
  let extra = '';
  if (model) {
    extra += ' Provide non-empty `llm_model_id`.';
  }
  if (md) {
    extra +=
      ' Supply full adapter `content` and/or `source_adapter_uri` (fork) so at least one source of content exists.';
  }
  return withRetry('train', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'train',
    message: `Input validation error: Invalid arguments for tool train.${extra} See train tool description for optional force_update, protocol_version, space.`,
    next_action:
      'Retry train with {"content":"...","llm_model_id":"..."} or with source_adapter_uri (and optional content override).',
    invalid_fields: paths,
    example: { content: '# My adapter\n\n## Step\n\n```json\n{"contract":{"type":"comment"}}\n```', llm_model_id: 'gpt-5.3-codex' }
  });
}

function teachingTune(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  return withRetry('tune', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'tune',
    message:
      'Input validation error: `tune` requires non-empty `uris` (adapter and/or layer URIs). Provide at least one of: parallel `content` strings (same length as uris), `updates` map, or `space` to move targets.',
    next_action:
      'Call tune with {"uris":["squadrules://adapter/<slug>"],"content":["..."]} or {"uris":[...],"space":"personal"}.',
    invalid_fields: paths,
    example: { uris: ['squadrules://adapter/phase-critic'], content: ['# Updated adapter markdown'] }
  });
}

function teachingDelete(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  return withRetry('delete', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'delete',
    message:
      'Input validation error: `delete` requires `uris`: a non-empty array of adapter-slug or layer URIs.',
    next_action: 'Retry delete with {"uris":["squadrules://adapter/<slug>"]} or layer URIs you intend to remove.',
    invalid_fields: paths,
    example: { uris: ['squadrules://adapter/phase-critic'] }
  });
}

function teachingExport(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  return withRetry('export', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'export',
    message:
      'Input validation error: `export` requires exactly one selection: `uri`, or non-empty `adapters`, or `all_adapters`+`space_name`. Default `format` is `skill_zip`; use `format: markdown` for flat single-file adapter Markdown. Optional `include_reward`.',
    next_action:
      'Call export with {"uri":"squadrules://adapter/<slug>","format":"skill_zip"} or for flat Markdown {"uri":"squadrules://adapter/<slug>","format":"markdown"}.',
    invalid_fields: paths,
    example: { uri: 'squadrules://adapter/phase-critic', format: 'skill_zip' }
  });
}

function teachingSpaces(error: ZodError, raw: unknown): Record<string, unknown> {
  const paths = issuePaths(error);
  return withRetry('spaces', raw, {
    error: MCP_INVALID_TOOL_INPUT,
    tool: 'spaces',
    message:
      'Input validation error: `spaces` accepts optional booleans only: `include_adapter_titles`, `include_widget_html` (both default false).',
    next_action: 'Call spaces with {} or {"include_adapter_titles":true} — use JSON true/false, not strings.',
    invalid_fields: paths,
    example: { include_adapter_titles: true }
  });
}

export function buildMcpInputTeachingPayload(
  tool: SquadrulesToolNameForInputTeaching,
  error: ZodError,
  _raw: unknown
): Record<string, unknown> {
  switch (tool) {
    case 'activate':
      return teachingActivate(error, _raw);
    case 'forward':
      return teachingForward(error, _raw);
    case 'reward':
      return teachingReward(error, _raw);
    case 'train':
      return teachingTrain(error, _raw);
    case 'tune':
      return teachingTune(error, _raw);
    case 'delete':
      return teachingDelete(error, _raw);
    case 'export':
      return teachingExport(error, _raw);
    case 'spaces':
      return teachingSpaces(error, _raw);
  }
}

export function mcpToolInputValidationErrorResult(
  tool: SquadrulesToolNameForInputTeaching,
  error: ZodError,
  raw: unknown
): { isError: true; content: [{ type: 'text'; text: string }] } {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(buildMcpInputTeachingPayload(tool, error, raw)) }]
  };
}
