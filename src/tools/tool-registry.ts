import { activateInputSchema, activateOutputSchema } from './activate_schema.js';
import { deleteInputSchema, deleteOutputSchema } from './delete_schema.js';
import { exportInputSchema, exportOutputSchema } from './export_schema.js';
import { forwardInputSchema, forwardOutputSchema } from './forward_schema.js';
import { rewardInputSchema, rewardOutputSchema } from './reward_schema.js';
import { spacesInputSchema, spacesOutputSchema } from './spaces_schema.js';
import { trainInputSchema, trainOutputSchema } from './train_schema.js';
import { tuneInputSchema, tuneOutputSchema } from './tune_schema.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import {
  SQUADRULES_ACTIVATE_TOOL_UI_META,
  SQUADRULES_FORWARD_TOOL_UI_META,
  SQUADRULES_SPACES_TOOL_UI_META
} from '../mcp-apps/squadrules-ui-constants.js';
import { TOOL_ANNOTATIONS, type SquadrulesToolNameLiteral } from './tool-annotations.js';
import { TOOL_ICONS } from './tool-icons.js';

/**
 * Canonical SQUADRULES MCP tool registry — the single source of truth for the tool
 * surface. MCP `tools/list` registration, the HTTP `/api/<tool>` routes, and the
 * CLI commands all derive from the same Zod schemas referenced here.
 *
 * Kept in its own module (rather than inline in server.ts) so that tests and the
 * cross-surface parity gates can import the canonical list without pulling in the
 * full server (no Qdrant/OpenAI side effects at import).
 *
 * Each tool includes:
 * - annotations: behavioral hints (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
 * - icons: display icons for UI (SVG data URIs at 48x48)
 * - description: names (a) what response contains, (b) next action on success, (c) recovery on failure
 */
export const SQUADRULES_TOOL_REGISTRY = [
  {
    name: 'activate',
    title: 'Activate the best adapter',
    uiMeta: SQUADRULES_ACTIVATE_TOOL_UI_META,
    annotations: TOOL_ANNOTATIONS.activate,
    icons: TOOL_ICONS.activate,
    description:
      resolveToolDoc('activate') ||
      'Find the best adapter for the current input and return ranked activation choices. Response contains adapter URIs, similarity scores, and ranked options. On success, call forward with the chosen adapter URI. On failure (no matches), refine your input or train a new adapter.',
    strictInputSchema: activateInputSchema,
    outputSchema: activateOutputSchema
  },
  {
    name: 'forward',
    title: 'Run adapter forward pass',
    uiMeta: SQUADRULES_FORWARD_TOOL_UI_META,
    annotations: TOOL_ANNOTATIONS.forward,
    icons: TOOL_ICONS.forward,
    description:
      resolveToolDoc('forward') ||
      'Load adapter instructions and advance workflow state. Response contains current layer content, execution ID, and next layer URI or completion status. On success, execute the layer and call reward with the outcome. On failure (missing proof), submit the required proof and retry forward.',
    strictInputSchema: forwardInputSchema,
    outputSchema: forwardOutputSchema
  },
  {
    name: 'train',
    title: 'Register a new adapter',
    annotations: TOOL_ANNOTATIONS.train,
    icons: TOOL_ICONS.train,
    description:
      resolveToolDoc('train') ||
      'Store a new adapter from markdown content. Response contains the adapter URI, layer count, and creation status. On success, call activate to find and use the new adapter. On failure (duplicate or similar adapter), inspect the match and either use force_update: true or choose a different title.',
    strictInputSchema: trainInputSchema,
    outputSchema: trainOutputSchema
  },
  {
    name: 'reward',
    title: 'Record adapter reward',
    annotations: TOOL_ANNOTATIONS.reward,
    icons: TOOL_ICONS.reward,
    description:
      resolveToolDoc('reward') ||
      'Attach a reward signal after adapter execution completes. Response contains the evaluation score, quality bonus, and storage confirmation. On success, the reward is recorded and the adapter is updated. On failure (proof conflict), fix the failed step and run it again before retrying reward.',
    strictInputSchema: rewardInputSchema,
    outputSchema: rewardOutputSchema
  },
  {
    name: 'tune',
    title: 'Update adapter content',
    annotations: TOOL_ANNOTATIONS.tune,
    icons: TOOL_ICONS.tune,
    description:
      resolveToolDoc('tune') ||
      'Update adapter layer content. Response contains the updated layer URI, new content hash, and modification timestamp. On success, call forward with the updated adapter to see changes. On failure (layer not found), verify the URI and train a new adapter if needed.',
    strictInputSchema: tuneInputSchema,
    outputSchema: tuneOutputSchema
  },
  {
    name: 'delete',
    title: 'Delete SQUADRULES adapter resource',
    annotations: TOOL_ANNOTATIONS.delete,
    icons: TOOL_ICONS.delete,
    description:
      resolveToolDoc('delete') ||
      'Delete an adapter or layer by URI. Response contains deletion results per URI with status and message. On success, the resource is removed and subsequent activate calls will not find it. On failure (resource not found), verify the URI or check if already deleted.',
    strictInputSchema: deleteInputSchema,
    outputSchema: deleteOutputSchema
  },
  {
    name: 'export',
    title: 'Export adapter or training data',
    annotations: TOOL_ANNOTATIONS.export,
    icons: TOOL_ICONS.export,
    description:
      resolveToolDoc('export') ||
      'Export adapter markdown or training datasets. Response contains export format (JSON, markdown, or zip), download URLs or inline content, and item counts. On success, use the provided URLs or content to import elsewhere. On failure (no data found), verify the export selection or train adapters first.',
    strictInputSchema: exportInputSchema,
    outputSchema: exportOutputSchema
  },
  {
    name: 'spaces',
    title: 'List spaces and adapter counts',
    uiMeta: SQUADRULES_SPACES_TOOL_UI_META,
    annotations: TOOL_ANNOTATIONS.spaces,
    icons: TOOL_ICONS.spaces,
    description:
      resolveToolDoc('spaces') ??
      "List the agent's available spaces with human-readable names and adapter counts. Response contains space IDs, display names, adapter counts, and optionally adapter titles and layer counts per space. On success, use space IDs to scope subsequent train or activate calls. On failure (no spaces), check agent configuration.",
    strictInputSchema: spacesInputSchema,
    outputSchema: spacesOutputSchema
  }
] as const;

/** Union of the canonical MCP tool names. */
export type SquadrulesToolName = SquadrulesToolNameLiteral;

/** Canonical MCP tool names in registration order. */
export const SQUADRULES_TOOL_NAMES: readonly SquadrulesToolName[] = SQUADRULES_TOOL_REGISTRY.map(
  (tool) => tool.name
);
