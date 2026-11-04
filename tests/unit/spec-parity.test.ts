/**
 * Static spec-parity gate — the no-infra twin of the runtime api-mcp-parity test.
 *
 * `src/tools/*_schema.ts` (Zod) is the single source of truth for the SQUADRULES tool
 * surface. This test asserts that every transport exposes that same surface
 * identically, WITHOUT starting a server or touching Qdrant/OpenAI, so cross-surface
 * spec drift fails the pipeline in seconds during the fast static phase:
 *   - MCP `tools/list` registration reuses the canonical Zod schemas (object identity).
 *   - Each `/api/<tool>` HTTP route is wired and validates with the canonical schema.
 *   - The CLI exposes exactly one command per tool (plus CLI-only auth/serve commands).
 *   - `src/embed-docs/tools/` has one doc per tool.
 *
 * The runtime api-mcp-parity test (auth stack) covers actual response shapes; this
 * gate cheaply catches registration/spec drift before any infra job starts.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  SQUADRULES_TOOL_REGISTRY,
  SQUADRULES_TOOL_NAMES,
  type SquadrulesToolName
} from '../../src/tools/tool-registry.js';
import { TOOL_ANNOTATIONS, type ToolAnnotations } from '../../src/tools/tool-annotations.js';
import { TOOL_ICONS } from '../../src/tools/tool-icons.js';
import { createProgram } from '../../src/cli/program.js';

import { activateInputSchema, activateOutputSchema } from '../../src/tools/activate_schema.js';
import { forwardInputSchema, forwardOutputSchema } from '../../src/tools/forward_schema.js';
import { trainInputSchema, trainOutputSchema } from '../../src/tools/train_schema.js';
import { rewardInputSchema, rewardOutputSchema } from '../../src/tools/reward_schema.js';
import { tuneInputSchema, tuneOutputSchema } from '../../src/tools/tune_schema.js';
import { deleteInputSchema, deleteOutputSchema } from '../../src/tools/delete_schema.js';
import { exportInputSchema, exportOutputSchema } from '../../src/tools/export_schema.js';
import { spacesInputSchema, spacesOutputSchema } from '../../src/tools/spaces_schema.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Independent, hardcoded expectation of the canonical tool set. Adding or removing a
 * tool must be a conscious edit here — this is what catches accidental registry drift.
 */
const EXPECTED_TOOL_NAMES = [
  'activate',
  'forward',
  'train',
  'reward',
  'tune',
  'delete',
  'export',
  'spaces'
] as const satisfies readonly SquadrulesToolName[];

/** CLI-only commands that intentionally have no MCP/HTTP tool counterpart. */
const CLI_ONLY_COMMANDS = ['serve', 'login', 'logout', 'token'] as const;

/** The canonical Zod schema objects, imported directly from src/tools/*_schema.ts. */
const CANONICAL_SCHEMAS: Record<SquadrulesToolName, { input: unknown; output: unknown }> = {
  activate: { input: activateInputSchema, output: activateOutputSchema },
  forward: { input: forwardInputSchema, output: forwardOutputSchema },
  train: { input: trainInputSchema, output: trainOutputSchema },
  reward: { input: rewardInputSchema, output: rewardOutputSchema },
  tune: { input: tuneInputSchema, output: tuneOutputSchema },
  delete: { input: deleteInputSchema, output: deleteOutputSchema },
  export: { input: exportInputSchema, output: exportOutputSchema },
  spaces: { input: spacesInputSchema, output: spacesOutputSchema }
};

/**
 * Expected HTTP surface per tool. `boundSchema` is the canonical input schema the
 * route validates with; `spaces` validates internally (no top-level schema import),
 * so it only asserts the route path + wiring.
 */
const HTTP_ROUTES: Record<
  SquadrulesToolName,
  { file: string; path: string; setup: string; boundSchema: string | null }
> = {
  activate: { file: 'http-api-begin.ts', path: '/api/activate', setup: 'setupActivateRoute', boundSchema: 'activateInputSchema' },
  forward: { file: 'http-api-begin-step.ts', path: '/api/forward', setup: 'setupForwardRoute', boundSchema: 'forwardInputSchema' },
  train: { file: 'http-api-train-json.ts', path: '/api/train', setup: 'setupTrainJsonRoute', boundSchema: 'trainInputSchema' },
  reward: { file: 'http-api-attest.ts', path: '/api/reward', setup: 'setupRewardRoute', boundSchema: 'rewardInputSchema' },
  tune: { file: 'http-api-update.ts', path: '/api/tune', setup: 'setupUpdateRoute', boundSchema: 'tuneInputSchema' },
  delete: { file: 'http-api-delete.ts', path: '/api/delete', setup: 'setupDeleteRoute', boundSchema: 'deleteInputSchema' },
  export: { file: 'http-api-dump.ts', path: '/api/export', setup: 'setupDumpRoute', boundSchema: 'exportInputSchema' },
  spaces: { file: 'http-api-spaces.ts', path: '/api/spaces', setup: 'setupSpacesRoute', boundSchema: null }
};

function readSrc(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('spec parity: MCP tool registry is the single source of truth', () => {
  test('registry exposes exactly the expected tool set', () => {
    expect([...SQUADRULES_TOOL_NAMES].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  test.each(EXPECTED_TOOL_NAMES)(
    'MCP "%s" registration reuses the canonical Zod input/output schemas',
    (name) => {
      const entry = SQUADRULES_TOOL_REGISTRY.find((tool) => tool.name === name);
      expect(entry).toBeDefined();
      // Object identity: the registry must reference the same schema instances,
      // not a divergent copy — this is what guarantees MCP === canonical.
      expect(entry!.strictInputSchema).toBe(CANONICAL_SCHEMAS[name].input);
      expect(entry!.outputSchema).toBe(CANONICAL_SCHEMAS[name].output);
    }
  );
});

describe('spec parity: HTTP /api routes bind the canonical schemas', () => {
  const routesIndex = readSrc('src/http/http-api-routes.ts');

  test.each(EXPECTED_TOOL_NAMES)('HTTP route for "%s" is wired in setupApiRoutes', (name) => {
    expect(routesIndex).toContain(HTTP_ROUTES[name].setup);
  });

  test.each(EXPECTED_TOOL_NAMES)(
    'HTTP route for "%s" registers its path and validates with the canonical schema',
    (name) => {
      const route = HTTP_ROUTES[name];
      const file = readSrc(`src/http/${route.file}`);
      // Route files use either quote style for the path literal.
      const registersPath =
        file.includes(`'${route.path}'`) || file.includes(`"${route.path}"`);
      expect(registersPath).toBe(true);
      if (route.boundSchema) {
        // Route must validate the body with the canonical input schema.
        expect(file).toContain(`${route.boundSchema}.safeParse`);
      }
    }
  );
});

describe('spec parity: CLI exposes one command per tool (plus CLI-only auth/serve)', () => {
  const commandNames = createProgram()
    .commands.map((command) => command.name())
    .sort();

  test('every canonical tool has a matching CLI command', () => {
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(commandNames).toContain(name);
    }
  });

  test('CLI exposes no unexpected commands beyond tools + documented CLI-only commands', () => {
    const allowed = new Set<string>([...EXPECTED_TOOL_NAMES, ...CLI_ONLY_COMMANDS]);
    const unexpected = commandNames.filter((name) => !allowed.has(name));
    expect(unexpected).toEqual([]);
  });
});

describe('spec parity: embedded tool docs align with the tool set', () => {
  test('src/embed-docs/tools has exactly one markdown doc per tool', () => {
    const docNames = readdirSync(resolve(REPO_ROOT, 'src/embed-docs/tools'))
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/, ''))
      .sort();
    expect(docNames).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });
});

describe('spec parity: MCP 2026-07-28 tool annotations', () => {
  test('every tool has annotations', () => {
    for (const tool of SQUADRULES_TOOL_REGISTRY) {
      expect(tool.annotations).toBeDefined();
      expect(typeof tool.annotations).toBe('object');
    }
  });

  test('annotations match the canonical TOOL_ANNOTATIONS map', () => {
    for (const tool of SQUADRULES_TOOL_REGISTRY) {
      const expected = TOOL_ANNOTATIONS[tool.name as SquadrulesToolName];
      expect(expected).toBeDefined();
      expect(tool.annotations).toEqual(expected);
    }
  });

  test.each(EXPECTED_TOOL_NAMES)(
    '"%s" annotations have valid hint types',
    (name) => {
      const tool = SQUADRULES_TOOL_REGISTRY.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const annotations = tool!.annotations as ToolAnnotations;

      // Each hint must be boolean if present
      if (annotations.readOnlyHint !== undefined) {
        expect(typeof annotations.readOnlyHint).toBe('boolean');
      }
      if (annotations.destructiveHint !== undefined) {
        expect(typeof annotations.destructiveHint).toBe('boolean');
      }
      if (annotations.idempotentHint !== undefined) {
        expect(typeof annotations.idempotentHint).toBe('boolean');
      }
      if (annotations.openWorldHint !== undefined) {
        expect(typeof annotations.openWorldHint).toBe('boolean');
      }

      // destructiveHint and idempotentHint are only meaningful when not read-only
      if (annotations.readOnlyHint === true) {
        // Read-only tools should not set destructiveHint or idempotentHint
        // (they default to false per spec, which is correct for read-only)
        expect(annotations.destructiveHint).toBeUndefined();
        expect(annotations.idempotentHint).toBeUndefined();
      }
    }
  );
});

describe('spec parity: MCP 2026-07-28 tool icons', () => {
  test('every tool has icons', () => {
    for (const tool of SQUADRULES_TOOL_REGISTRY) {
      expect(tool.icons).toBeDefined();
      expect(Array.isArray(tool.icons)).toBe(true);
      expect(tool.icons.length).toBeGreaterThan(0);
    }
  });

  test('icons match the canonical TOOL_ICONS map', () => {
    for (const tool of SQUADRULES_TOOL_REGISTRY) {
      const expected = TOOL_ICONS[tool.name as SquadrulesToolName];
      expect(expected).toBeDefined();
      expect(tool.icons).toEqual(expected);
    }
  });

  test.each(EXPECTED_TOOL_NAMES)(
    '"%s" icons have required fields (src, mimeType, sizes)',
    (name) => {
      const tool = SQUADRULES_TOOL_REGISTRY.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const icons = tool!.icons;
      expect(Array.isArray(icons)).toBe(true);

      for (const icon of icons) {
        expect(typeof icon.src).toBe('string');
        expect(icon.src.length).toBeGreaterThan(0);
        expect(typeof icon.mimeType).toBe('string');
        expect(icon.mimeType.length).toBeGreaterThan(0);
        expect(Array.isArray(icon.sizes)).toBe(true);
        expect(icon.sizes.length).toBeGreaterThan(0);
        // Each size should be in WxH format
        for (const size of icon.sizes) {
          expect(size).toMatch(/^\d+x\d+$/);
        }
      }
    }
  );
});

describe('spec parity: tool descriptions meet format requirements', () => {
  test.each(EXPECTED_TOOL_NAMES)(
    '"%s" description names response content, next action, and failure recovery',
    (name) => {
      const tool = SQUADRULES_TOOL_REGISTRY.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const description = tool!.description;
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(20);

      // Description should mention what the response contains
      expect(description.toLowerCase()).toMatch(/response contains|returns|provides/);

      // Description should mention next action on success
      expect(description.toLowerCase()).toMatch(/on success|next|then|call|use/);

      // Description should mention recovery on failure
      expect(description.toLowerCase()).toMatch(/on failure|if.*fail|error|retry|fix/);
    }
  );
});
