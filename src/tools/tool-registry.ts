// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
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
  KAIROS_ACTIVATE_TOOL_UI_META,
  KAIROS_FORWARD_TOOL_UI_META,
  KAIROS_SPACES_TOOL_UI_META
} from '../mcp-apps/kairos-ui-constants.js';

/**
 * Canonical SQUADRULES MCP tool registry — the single source of truth for the tool
 * surface. MCP `tools/list` registration, the HTTP `/api/<tool>` routes, and the
 * CLI commands all derive from the same Zod schemas referenced here.
 *
 * Kept in its own module (rather than inline in server.ts) so that tests and the
 * cross-surface parity gates can import the canonical list without pulling in the
 * full server (no Qdrant/OpenAI side effects at import).
 */
export const KAIROS_TOOL_REGISTRY = [
  {
    name: 'activate',
    title: 'Activate the best adapter',
    uiMeta: KAIROS_ACTIVATE_TOOL_UI_META,
    description:
      resolveToolDoc('activate') ||
      'Find the best adapter for the current input and return ranked activation choices.',
    strictInputSchema: activateInputSchema,
    outputSchema: activateOutputSchema
  },
  {
    name: 'forward',
    title: 'Run adapter forward pass',
    uiMeta: KAIROS_FORWARD_TOOL_UI_META,
    description:
      resolveToolDoc('forward') ||
      'Run the first or next adapter layer. Omit `solution` on the first call in a run.',
    strictInputSchema: forwardInputSchema,
    outputSchema: forwardOutputSchema
  },
  {
    name: 'train',
    title: 'Register a new adapter',
    description: resolveToolDoc('train') || 'Store a new adapter from markdown.',
    strictInputSchema: trainInputSchema,
    outputSchema: trainOutputSchema
  },
  {
    name: 'reward',
    title: 'Record adapter reward',
    description: resolveToolDoc('reward') || 'Attach a reward signal after adapter execution completes.',
    strictInputSchema: rewardInputSchema,
    outputSchema: rewardOutputSchema
  },
  {
    name: 'tune',
    title: 'Update adapter content',
    description: resolveToolDoc('tune') || 'Update adapter layer content.',
    strictInputSchema: tuneInputSchema,
    outputSchema: tuneOutputSchema
  },
  {
    name: 'delete',
    title: 'Delete SQUADRULES adapter resource',
    description: resolveToolDoc('delete') || 'Delete an adapter or layer by URI.',
    strictInputSchema: deleteInputSchema,
    outputSchema: deleteOutputSchema
  },
  {
    name: 'export',
    title: 'Export adapter or training data',
    description: resolveToolDoc('export') || 'Export adapter markdown or training datasets.',
    strictInputSchema: exportInputSchema,
    outputSchema: exportOutputSchema
  },
  {
    name: 'spaces',
    title: 'List spaces and adapter counts',
    uiMeta: KAIROS_SPACES_TOOL_UI_META,
    description:
      resolveToolDoc('spaces') ??
      "List the agent's available spaces with human-readable names and adapter counts. Optionally include adapter titles and layer counts per space.",
    strictInputSchema: spacesInputSchema,
    outputSchema: spacesOutputSchema
  }
] as const;

/** Union of the canonical MCP tool names. */
export type SquadrulesToolName = (typeof KAIROS_TOOL_REGISTRY)[number]['name'];

/** Canonical MCP tool names in registration order. */
export const KAIROS_TOOL_NAMES: readonly SquadrulesToolName[] = KAIROS_TOOL_REGISTRY.map(
  (tool) => tool.name
);
