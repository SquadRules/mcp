// squadrules-compat-surface: dual-accepts canonical kairos:// URIs (squadrules:// alias) so existing stored URIs and clients keep resolving
const CONTRACT_TYPES = new Set(['tensor', 'shell', 'mcp', 'user_input', 'comment']);
const CHOICE_ROLES = new Set(['match', 'refine', 'create']);
const GRADER_KINDS = new Set(['human', 'model', 'unknown']);
const EVALUATION_LABELS = new Set(['gold', 'silver', 'bronze', 'rejected']);

function classifySquadrulesUriKind(uri) {
  if (typeof uri !== 'string' || !uri) return 'missing';
  if (/^kairos:\/\/adapter\//i.test(uri)) return 'adapter';
  if (/^kairos:\/\/layer\//i.test(uri)) return 'layer';
  if (/^kairos:\/\/mem\//i.test(uri)) return 'mem';
  return 'other';
}

function classifyContractType(type) {
  return typeof type === 'string' && CONTRACT_TYPES.has(type) ? type : 'other';
}

function classifyChoiceRole(role) {
  return typeof role === 'string' && CHOICE_ROLES.has(role) ? role : 'other';
}

function classifyEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : 'other';
}

function classifyNextActionKind(nextAction) {
  if (typeof nextAction !== 'string' || !nextAction) return 'missing';
  if (nextAction.includes('call reward')) return 'reward';
  if (nextAction.includes('call forward')) return 'forward';
  if (nextAction.includes('pick one choice')) return 'pick_choice';
  if (nextAction.includes('ask the user')) return 'ask_user';
  return 'other';
}

export function buildRequestProof(endpoint, authPresent, details = {}) {
  return { endpoint, auth_present: authPresent, ...details };
}

export function buildTrainResponseProof(status, data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    http_status: status,
    result_kind:
      status === 200 && data?.status === 'stored'
        ? 'stored'
        : status === 401
          ? 'auth_required'
          : data?.error
            ? 'error'
            : 'unknown',
    items_count: items.length,
    first_item_uri_kind: classifySquadrulesUriKind(items[0]?.uri),
    first_adapter_uri_kind: classifySquadrulesUriKind(items[0]?.adapter_uri),
    has_login_url: typeof data?.login_url === 'string',
    has_message: typeof data?.message === 'string'
  };
}

export function buildActivateResponseProof(status, data) {
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  return {
    http_status: status,
    result_kind:
      status === 200 && choices.length > 0
        ? 'choices'
        : status === 401
          ? 'auth_required'
          : data?.error
            ? 'error'
            : 'unknown',
    choice_count: choices.length,
    match_choice_count: choices.filter((choice) => choice?.role === 'match').length,
    first_choice_role: classifyChoiceRole(choices[0]?.role),
    first_choice_uri_kind: classifySquadrulesUriKind(choices[0]?.uri),
    next_action_kind: classifyNextActionKind(data?.next_action)
  };
}

export function buildForwardResponseProof(status, data) {
  const nextActionKind = classifyNextActionKind(data?.next_action);
  return {
    http_status: status,
    result_kind:
      typeof data?.error_code === 'string'
        ? 'error'
        : nextActionKind === 'reward'
          ? 'reward_ready'
          : data?.current_layer?.uri
            ? 'layer_prompt'
            : 'unknown',
    current_layer_uri_kind: classifySquadrulesUriKind(data?.current_layer?.uri),
    contract_type: classifyContractType(data?.contract?.type),
    next_action_kind: nextActionKind,
    has_proof_hash: typeof data?.proof_hash === 'string',
    has_execution_id: typeof data?.execution_id === 'string',
    retry_count: typeof data?.retry_count === 'number' ? data.retry_count : 0,
    has_error_code: typeof data?.error_code === 'string'
  };
}

export function buildRewardResponseProof(status, data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    http_status: status,
    result_kind:
      status === 200 && results.length > 0
        ? 'rated'
        : status === 401
          ? 'auth_required'
          : data?.error
            ? 'error'
            : 'unknown',
    results_count: results.length,
    total_rated: typeof data?.total_rated === 'number' ? data.total_rated : 0,
    total_failed: typeof data?.total_failed === 'number' ? data.total_failed : 0,
    first_grader_kind: classifyEnum(results[0]?.grader_kind, GRADER_KINDS),
    first_evaluation_label: classifyEnum(results[0]?.evaluation_label, EVALUATION_LABELS)
  };
}

export function classifySolutionType(type) {
  return classifyContractType(type);
}

export function classifyUriKind(uri) {
  return classifySquadrulesUriKind(uri);
}
