// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
/**
 * Integration: `activate` MCP tool — response shape, meta footers, and slug contract.
 *
 * Prerequisites: dev stack reachable (`npm run dev:deploy` / ENV=dev), auth as configured for
 * integration tests, Qdrant indexing lag tolerated via polling where needed.
 *
 * Train + activate share scope via `space_id` from `getTestSpaceId()` so adapters trained in-test are visible.
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { getTestSpaceId } from '../../utils/auth-headers.js';
import { AUTHOR_SLUG_RE } from '../../../src/utils/protocol-slug.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';
import {
  type ActivateChoice,
  expectActivateChoiceSlugField,
  expectConfidencePercentInMessage,
  expectNoDeprecatedTopLevelFields,
  nextActionLooksActionable,
  type ParsedActivate,
  sleep
} from '../v4-activate-test-helpers.js';

/** Built-in meta adapters (slug routing URIs). */
const URI_REFINE_SEARCH = 'kairos://adapter/refine-search' as const;
const URI_CREATE_PROTOCOL = 'kairos://adapter/create-new-protocol' as const;

const RE_ADAPTER_URI = /^kairos:\/\/adapter\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

const TRAIN_LLM_MODEL_ID = 'test-v4-activate';

/** After train, allow vector index to catch up before activate (single-adapter cases). */
const SETTLE_AFTER_TRAIN_MS = 4000;
/** Shorter settle for field-shape test (warm-ish index). */
const SETTLE_AFTER_TRAIN_SHORT_MS = 2000;

describe('v4-activate unified response schema', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  async function activateQuery(query: string, opts?: { execution_id?: string }) {
    const args: { query: string; space_id?: string; execution_id?: string } = { query };
    const spaceId = getTestSpaceId();
    if (spaceId) args.space_id = spaceId;
    if (opts?.execution_id) args.execution_id = opts.execution_id;
    const call = { name: 'activate' as const, arguments: args };
    const result = await mcpConnection.client.callTool(call);
    return { call, result, parsed: parseMcpJson(result, 'v4-activate') };
  }

  function buildMinimalProtocolBody(title: string): string {
    return `# ${title}

## Activation Patterns
When.

## Step 1
Do something.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`

## Reward Signal
Done.`;
  }

  async function trainMinimalProtocol(title: string): Promise<void> {
    const content = buildMinimalProtocolBody(title);
    await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: content, llm_model_id: TRAIN_LLM_MODEL_ID, force_update: true, review_evidence: MOCK_REVIEW_EVIDENCE }
    });
  }

  /** Train with YAML `slug:` so Qdrant stores a routing slug; activate must echo it on the match row. */
  async function trainMinimalProtocolWithRoutingSlug(title: string, routingSlug: string): Promise<void> {
    expect(routingSlug).toMatch(AUTHOR_SLUG_RE);
    const content = `---
slug: ${routingSlug}
---

${buildMinimalProtocolBody(title)}`;
    await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: content, llm_model_id: TRAIN_LLM_MODEL_ID, force_update: true, review_evidence: MOCK_REVIEW_EVIDENCE }
    });
  }

  /**
   * Re-call activate after incremental delays until predicate passes or attempts exhausted.
   * Returns the last attempt (caller should assert predicate or fail with context).
   */
  async function pollActivate(
    query: string,
    options: { delaysMs: number[]; until: (parsed: ParsedActivate) => boolean }
  ): Promise<{ call: { name: string; arguments: Record<string, unknown> }; result: unknown; parsed: ParsedActivate }> {
    let last = await activateQuery(query);
    if (options.until(last.parsed)) {
      return last;
    }
    for (const ms of options.delaysMs) {
      await sleep(ms);
      last = await activateQuery(query);
      if (options.until(last.parsed)) {
        return last;
      }
    }
    return last;
  }

  test('trained adapter: envelope, match choice shape, and no obsolete top-level fields', async () => {
    const ts = Date.now();
    const title = `V4ActivateSingle ${ts}`;
    await trainMinimalProtocol(title);

    await sleep(SETTLE_AFTER_TRAIN_MS);
    const { call, result, parsed } = await activateQuery(title);

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(typeof parsed.message).toBe('string');
      expectConfidencePercentInMessage(parsed.message);
      expect(typeof parsed.next_action).toBe('string');
      expect(nextActionLooksActionable(parsed.next_action)).toBe(true);
      expect(Array.isArray(parsed.choices)).toBe(true);
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);

      const matchChoice = parsed.choices.find((c: ActivateChoice) => c.role === 'match') as ActivateChoice | undefined;
      const choice = (matchChoice ?? parsed.choices[0]) as ActivateChoice;
      expect(choice).toBeDefined();
      expect(choice.uri).toMatch(RE_ADAPTER_URI);
      expect(typeof choice.label).toBe('string');
      if (parsed.next_action.includes("choice's next_action")) {
        expect(choice).toHaveProperty('next_action');
      }
      expect(['match', 'refine', 'create']).toContain(choice.role);
      if (choice.role === 'match') {
        expect(typeof choice.activation_score).toBe('number');
        expect(choice.activation_score as number).toBeGreaterThanOrEqual(0);
        expect(choice.activation_score as number).toBeLessThanOrEqual(1);
        expectActivateChoiceSlugField(choice);
      } else {
        expect(choice.activation_score).toBeNull();
      }
      expect(Array.isArray(choice.tags)).toBe(true);

      expectNoDeprecatedTopLevelFields(parsed);
    });
  });

  test('match row echoes routing slug after train stores slug frontmatter', async () => {
    const ts = Date.now();
    const routingSlug = `v4-activate-route-${ts}`;
    const title = `V4ActivateSlugEcho ${ts}`;
    await trainMinimalProtocolWithRoutingSlug(title, routingSlug);
    await sleep(SETTLE_AFTER_TRAIN_MS);

    const rowForOurAdapter = (p: ParsedActivate) =>
      p.choices.some(
        (c: ActivateChoice) =>
          c.role === 'match' && String(c.adapter_name ?? c.label ?? '') === title
      );

    const { call, result, parsed } = await pollActivate(title, {
      delaysMs: [3000, 4000, 4000],
      until: rowForOurAdapter
    });

    withRawOnFail({ call, result }, () => {
      const ours = parsed.choices.find(
        (c: ActivateChoice) =>
          c.role === 'match' && String(c.adapter_name ?? '') === title
      ) as ActivateChoice | undefined;
      if (ours === undefined) {
        throw new Error(
          `no match row for trained adapter "${title}"; got ${JSON.stringify(
            parsed.choices.map((c: ActivateChoice) => ({
              role: c.role,
              adapter_name: c.adapter_name,
              slug: c.slug
            }))
          )}`
        );
      }
      expect(ours.slug).toBe(routingSlug);
      expect(String(ours.slug)).toMatch(AUTHOR_SLUG_RE);
    });
  }, 60000);

  test('vector matches never duplicate builtin refine/create adapter URIs', async () => {
    const { call, result, parsed } = await activateQuery('protocol');

    withRawOnFail({ call, result }, () => {
      const matches = parsed.choices.filter((c: ActivateChoice) => c.role === 'match');
      expect(matches.some((c: ActivateChoice) => c.uri === URI_REFINE_SEARCH)).toBe(false);
      expect(matches.some((c: ActivateChoice) => c.uri === URI_CREATE_PROTOCOL)).toBe(false);
      const footerCreate = parsed.choices.filter(
        (c: ActivateChoice) => c.role === 'create' && c.uri === URI_CREATE_PROTOCOL
      );
      expect(footerCreate.length).toBeLessThanOrEqual(1);
    });
  }, 45000);

  test('no vector match: refine/create footers and refine label stable', async () => {
    const ts = Date.now();
    const gibberish = `XyZ123GarbageV4Test${ts}NoOneSearchesThis`;

    const { call, result, parsed } = await activateQuery(gibberish);

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(typeof parsed.message).toBe('string');
      expect(typeof parsed.next_action).toBe('string');
      expect(Array.isArray(parsed.choices)).toBe(true);
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);

      const refineChoice = parsed.choices.find((c: ActivateChoice) => c.role === 'refine');
      const createChoice = parsed.choices.find((c: ActivateChoice) => c.role === 'create');
      expect(createChoice).toBeDefined();
      expect(createChoice!.activation_score).toBeNull();
      expect(createChoice!.uri).toMatch(RE_ADAPTER_URI);
      expect(refineChoice).toBeDefined();
      expect(refineChoice!.uri).toBe(URI_REFINE_SEARCH);
      expect(typeof refineChoice!.next_action).toBe('string');
      expect(refineChoice!.next_action).toContain('forward');
      expect(refineChoice!.next_action).toContain('refine-search');
      expect(refineChoice!.label).toBe('Get help refining your search');
      if (createChoice!.next_action !== undefined) {
        expect(typeof createChoice!.next_action).toBe('string');
      }

      expectNoDeprecatedTopLevelFields(parsed);
    });
  });

  test('create footer choice remains discoverable for authoring-style query', async () => {
    const { call, result, parsed } = await activateQuery('Register personal SQUADRULES adapter');

    withRawOnFail({ call, result }, () => {
      const createChoice = parsed.choices.find(
        (c: ActivateChoice) => c.role === 'create' && c.uri === URI_CREATE_PROTOCOL
      );
      expect(createChoice).toBeDefined();
      expect(String(createChoice!.label).toLowerCase()).toContain('kairos');
      expect(String(createChoice!.label).toLowerCase()).toContain('protocol');
      expect(String(createChoice!.label).toLowerCase()).toMatch(/create|review|refactor/);
      expect(String(createChoice!.next_action).toLowerCase()).toContain('register');
      expect(String(createChoice!.next_action).toLowerCase()).toContain('adapter/protocol/workflow');
    });
  });

  test('two trained adapters: at least two match rows, footers and scores bounded', async () => {
    const ts = Date.now();
    const token = `V4ActivateMulti${ts}`;
    await trainMinimalProtocol(`${token} Alpha`);
    await trainMinimalProtocol(`${token} Beta`);

    const minMatches = (p: ParsedActivate) =>
      p.choices.filter((c: ActivateChoice) => c.role === 'match').length >= 2;

    const { call, result, parsed } = await pollActivate(token, {
      delaysMs: [6000, 3000, 3000, 3000, 3000],
      until: minMatches
    });

    withRawOnFail({ call, result }, () => {
      const matches = parsed.choices.filter((c: ActivateChoice) => c.role === 'match');
      if (matches.length < 2) {
        throw new Error(
          `expected ≥2 match rows after polling; got ${matches.length}. choices=${JSON.stringify(
            parsed.choices.map((c: ActivateChoice) => ({ role: c.role, uri: c.uri }))
          )}`
        );
      }
      expect(matches.length).toBeGreaterThanOrEqual(2);

      expect(parsed.must_obey).toBe(true);
      expect(Array.isArray(parsed.choices)).toBe(true);
      expectConfidencePercentInMessage(parsed.message);

      for (const match of matches) {
        expect(match.activation_score).toBeGreaterThanOrEqual(0);
        expect(match.activation_score).toBeLessThanOrEqual(1);
        expectActivateChoiceSlugField(match as ActivateChoice);
      }

      const refineChoice = parsed.choices.find((c: ActivateChoice) => c.role === 'refine');
      const createChoice = parsed.choices.find((c: ActivateChoice) => c.role === 'create');
      expect(refineChoice).toBeDefined();
      expect(createChoice).toBeDefined();
      expect(refineChoice!.uri).toBe(URI_REFINE_SEARCH);
      expect(refineChoice!.next_action).toContain('forward');
      expect(refineChoice!.next_action).toContain('refine-search');
      expect(createChoice!.uri).toBe(URI_CREATE_PROTOCOL);
      expect(createChoice!.next_action).toContain('train');
    });
  }, 60000);

  test('every choice exposes required fields; slug follows protocol rules', async () => {
    const ts = Date.now();
    const title = `V4ActivateFields ${ts}`;
    await trainMinimalProtocol(title);

    await sleep(SETTLE_AFTER_TRAIN_SHORT_MS);
    const { call, result, parsed } = await activateQuery(title);

    withRawOnFail({ call, result }, () => {
      const usesPerChoiceNextAction =
        typeof parsed.next_action === 'string' && parsed.next_action.includes("choice's next_action");

      for (const raw of parsed.choices) {
        const choice = raw as ActivateChoice;
        expect(choice).toHaveProperty('uri');
        expect(choice).toHaveProperty('label');
        expect(choice).toHaveProperty('adapter_name');
        expect(choice).toHaveProperty('activation_score');
        expect(choice).toHaveProperty('role');
        expect(choice).toHaveProperty('tags');
        expect(choice).toHaveProperty('slug');
        if (usesPerChoiceNextAction) {
          expect(choice).toHaveProperty('next_action');
        }
        expect(['match', 'refine', 'create']).toContain(choice.role);
        if (choice.role === 'match') {
          expect(choice.activation_score).toBeGreaterThanOrEqual(0);
          expect(choice.activation_score).toBeLessThanOrEqual(1);
        }
        expectActivateChoiceSlugField(choice);
      }
    });
  }, 45000);
});
