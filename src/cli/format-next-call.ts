type JsonObject = Record<string, unknown>;

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function buildForwardSnippet(nextCall: JsonObject): string | null {
  const kind = nextCall['kind'];
  const args = nextCall['args'];
  if (!isObject(args) || typeof args['uri'] !== 'string') return null;
  if (kind === 'forward') {
    const payload = {
      uri: args['uri'],
      solution: isObject(args['solution_template']) ? args['solution_template'] : {}
    };
    return `squadrules forward '${payload.uri}' --solution '${JSON.stringify(payload.solution)}'`;
  }
  if (kind === 'reward') {
    return `squadrules reward '${args['uri']}' success 'completed'`;
  }
  return null;
}

export function formatNextCallBlock(response: unknown): string | null {
  if (!isObject(response)) return null;

  if (isObject(response['next_call'])) {
    const nextCall = response['next_call'] as JsonObject;
    const snippet = buildForwardSnippet(nextCall);
    const lines = ['next_call:', toJson(nextCall)];
    if (snippet) {
      lines.push('shell_snippet:', snippet);
    }
    return lines.join('\n');
  }

  if (Array.isArray(response['choices'])) {
    const candidates = (response['choices'] as unknown[])
      .map((choice) => (isObject(choice) ? choice : null))
      .filter((choice): choice is JsonObject => choice !== null)
      .map((choice) => ({
        role: choice['role'],
        label: choice['label'],
        forward_first_call: choice['forward_first_call']
      }))
      .filter((choice) => isObject(choice.forward_first_call));
    if (candidates.length === 0) return null;
    const first = candidates[0]!;
    const uri =
      isObject(first.forward_first_call) && typeof first.forward_first_call['uri'] === 'string'
        ? first.forward_first_call['uri']
        : null;
    const lines = ['next_call_candidates:', toJson(candidates)];
    if (uri) {
      lines.push('shell_snippet:', `squadrules forward '${uri}'`);
    }
    return lines.join('\n');
  }

  if ('next_call' in response && response['next_call'] === null) {
    return 'next_call: null';
  }

  return null;
}
