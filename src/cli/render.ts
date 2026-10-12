/**
 * Human-first renderers for CLI data-command output (pretty + text), plus the
 * next-call hint.
 *
 * `pretty` is the default on a TTY: a compact, readable rendering on stdout. `text`
 * is a minimal, script-friendly rendering. JSON mode bypasses these and prints the
 * canonical response object. The next-call hint (the shell command to run next) is
 * printed on stderr in pretty mode only — JSON mode keeps the structured `next_call`
 * in the body, so the two never mix text into JSON.
 */
import type { ActivateOutput } from '../tools/activate_schema.js';
import type { ForwardOutput } from '../tools/forward_schema.js';
import type { RewardOutput } from '../tools/reward_schema.js';
import type { TuneOutput } from '../tools/tune_schema.js';
import type { DeleteOutput } from '../tools/delete_schema.js';
import type { TrainOutput } from '../tools/train_schema.js';
import type { SpacesOutput } from './backend/action-backend.js';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function shellQuote(value: string): string {
  return `'${value}'`;
}

// ---------------------------------------------------------------------------
// next-call hint (stderr, pretty mode)
// ---------------------------------------------------------------------------

function forwardSnippetFromNextCall(nextCall: JsonObject): string | null {
  const kind = nextCall['kind'];
  const args = nextCall['args'];
  if (!isObject(args) || typeof args['uri'] !== 'string') return null;
  if (kind === 'forward') {
    const solution = isObject(args['solution_template']) ? args['solution_template'] : {};
    return `squadrules forward ${shellQuote(args['uri'])} --solution ${shellQuote(JSON.stringify(solution))}`;
  }
  if (kind === 'reward') {
    return `squadrules reward ${shellQuote(args['uri'])} success 'completed'`;
  }
  return null;
}

function forwardSnippetFromChoices(response: JsonObject): string | null {
  if (!Array.isArray(response['choices'])) return null;
  for (const choice of response['choices'] as unknown[]) {
    if (!isObject(choice)) continue;
    const first = choice['forward_first_call'];
    if (isObject(first) && typeof first['uri'] === 'string') {
      return `squadrules forward ${shellQuote(first['uri'])}`;
    }
  }
  return null;
}

/**
 * Build the short "run this next" hint for pretty mode. Returns null when the response
 * carries no actionable next step (for example a terminal reward).
 */
export function nextCallHint(response: unknown): string | null {
  if (!isObject(response)) return null;
  if (isObject(response['next_call'])) {
    const snippet = forwardSnippetFromNextCall(response['next_call'] as JsonObject);
    return snippet ? `next: ${snippet}` : null;
  }
  const fromChoices = forwardSnippetFromChoices(response);
  if (fromChoices) return `next: ${fromChoices}`;
  return null;
}

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

export function renderActivatePretty(out: ActivateOutput): string {
  const lines: string[] = [`activate: ${JSON.stringify(out.query)}`];
  if (out.message) lines.push(out.message);
  const choices = out.choices ?? [];
  if (choices.length === 0) {
    lines.push('', 'No matching adapters.');
    return lines.join('\n');
  }
  lines.push('', `Choices (${choices.length}):`);
  choices.forEach((choice, index) => {
    const score =
      typeof choice.activation_score === 'number' ? ` score ${choice.activation_score.toFixed(2)}` : '';
    const space = choice.space_name ? ` [${choice.space_name}]` : '';
    lines.push(`  ${index + 1}. (${choice.role}) ${choice.label}${score}${space}`);
    lines.push(`     ${choice.uri}`);
    if (choice.next_action) lines.push(`     do: ${choice.next_action}`);
  });
  return lines.join('\n');
}

export function renderActivateText(out: ActivateOutput): string {
  return (out.choices ?? []).map((choice) => choice.uri).join('\n');
}

// ---------------------------------------------------------------------------
// forward
// ---------------------------------------------------------------------------

export function renderForwardPretty(out: ForwardOutput): string {
  const lines: string[] = [];
  const heading = out.current_layer_label ?? out.context_adapter_name ?? 'forward';
  lines.push(`forward: ${heading}`);
  if (out.adapter_layer_index && out.adapter_layer_count) {
    lines.push(`step ${out.adapter_layer_index}/${out.adapter_layer_count}`);
  }
  const contractType = out.contract?.type ?? 'n/a';
  const contractDesc = out.contract?.description ? ` — ${out.contract.description}` : '';
  lines.push(`contract: ${contractType}${contractDesc}`);
  if (out.message) lines.push(out.message);
  if (out.current_layer?.content) {
    lines.push('', out.current_layer.content.trim());
  }
  if (out.next_action) lines.push('', `do: ${out.next_action}`);
  return lines.join('\n');
}

export function renderForwardText(out: ForwardOutput): string {
  return out.next_action ?? '';
}

// ---------------------------------------------------------------------------
// reward
// ---------------------------------------------------------------------------

export function renderRewardPretty(out: RewardOutput): string {
  const lines: string[] = [`reward: rated ${out.total_rated}, failed ${out.total_failed}`];
  for (const row of out.results ?? []) {
    const score = typeof row.score === 'number' ? ` score ${row.score.toFixed(2)}` : '';
    lines.push(`  ${row.uri} → ${row.outcome}${score} (${row.evaluation_label})`);
  }
  return lines.join('\n');
}

export function renderRewardText(out: RewardOutput): string {
  return `rated ${out.total_rated} failed ${out.total_failed}`;
}

// ---------------------------------------------------------------------------
// tune
// ---------------------------------------------------------------------------

export function renderTunePretty(out: TuneOutput): string {
  const lines: string[] = [`tune: updated ${out.total_updated}, failed ${out.total_failed}`];
  for (const row of out.results ?? []) {
    lines.push(`  ${row.uri} → ${row.status}: ${row.message}`);
  }
  return lines.join('\n');
}

export function renderTuneText(out: TuneOutput): string {
  return `updated ${out.total_updated} failed ${out.total_failed}`;
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

export function renderDeletePretty(out: DeleteOutput): string {
  const lines: string[] = [`delete: deleted ${out.total_deleted}, failed ${out.total_failed}`];
  for (const row of out.results ?? []) {
    lines.push(`  ${row.uri} → ${row.status}: ${row.message}`);
  }
  return lines.join('\n');
}

export function renderDeleteText(out: DeleteOutput): string {
  return `deleted ${out.total_deleted} failed ${out.total_failed}`;
}

// ---------------------------------------------------------------------------
// spaces
// ---------------------------------------------------------------------------

export function renderSpacesPretty(out: SpacesOutput): string {
  const spaces = out.spaces ?? [];
  if (spaces.length === 0) return 'spaces: (none)';
  const lines: string[] = [`spaces (${spaces.length}):`];
  for (const space of spaces) {
    lines.push(`  ${space.name} (${space.type}): ${space.adapter_count} adapters`);
    for (const adapter of space.adapters ?? []) {
      lines.push(`    - ${adapter.title} (${adapter.layer_count} layers) ${adapter.uri}`);
    }
  }
  return lines.join('\n');
}

export function renderSpacesText(out: SpacesOutput): string {
  return (out.spaces ?? [])
    .map((space) => `${space.name}\t${space.type}\t${space.adapter_count}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// train
// ---------------------------------------------------------------------------

export function renderTrainPretty(out: TrainOutput): string {
  const items = out.items ?? [];
  const lines: string[] = [`train: ${out.status} ${items.length} item(s)`];
  for (const item of items) {
    lines.push(`  ${item.label} → ${item.uri}`);
  }
  return lines.join('\n');
}

export function renderTrainText(out: TrainOutput): string {
  return (out.items ?? []).map((item) => item.uri).join('\n');
}
