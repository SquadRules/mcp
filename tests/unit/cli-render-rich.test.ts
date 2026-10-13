/**
 * Rich-output unit tests: color helpers, ASCII table builder, and TTY-aware color
 * stripping. Pure — no server, no embedded store, no ONNX.
 *
 * render-helpers.ts checks `process.stdout.isTTY` dynamically per call, so tests
 * can toggle isTTY to verify both colored and stripped output.
 */
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { c, asciiTable } from '../../src/cli/render-helpers.js';
import {
  renderActivatePretty,
  renderSpacesPretty,
  renderRewardPretty,
  renderForwardPretty,
  renderTrainPretty,
} from '../../src/cli/render.js';
import type { ActivateOutput } from '../../src/tools/activate_schema.js';
import type { SpacesOutput } from '../../src/cli/backend/action-backend.js';
import type { RewardOutput } from '../../src/tools/reward_schema.js';
import type { ForwardOutput } from '../../src/tools/forward_schema.js';
import type { TrainOutput } from '../../src/tools/train_schema.js';

// ANSI escape code regex
const ANSI_RE = /\x1b\[\d+(;\d+)*m/;

describe('asciiTable', () => {
  it('aligns columns and pads with dashes', () => {
    const table = asciiTable(['Name', 'Type', 'Count'], [
      ['Personal', 'other', '0'],
      ['Squadrules app', 'app', '11'],
    ]);
    const lines = table.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 data rows
    expect(lines[0]).toBe('Name            Type   Count');
    expect(lines[1]).toMatch(/^─+/);
    expect(lines[2]).toContain('Personal');
    expect(lines[3]).toContain('Squadrules app');
  });

  it('handles empty rows', () => {
    const table = asciiTable(['A', 'B'], []);
    const lines = table.split('\n');
    expect(lines).toHaveLength(2); // header + separator only
    expect(lines[0]).toBe('A  B');
  });
});

describe('color helpers (TTY-aware)', () => {
  const origIsTTY = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('emits ANSI escape sequences on TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    expect(c.heading('test')).toMatch(ANSI_RE);
    expect(c.score(0.85)).toMatch(ANSI_RE);
    expect(c.success('ok')).toMatch(ANSI_RE);
    expect(c.error('fail')).toMatch(ANSI_RE);
    expect(c.dim('uri')).toMatch(ANSI_RE);
    expect(c.role('match')).toMatch(ANSI_RE);
    expect(c.space('personal')).toMatch(ANSI_RE);
  });

  it('strips ANSI codes when piped (non-TTY)', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(c.heading('test')).toBe('test');
    expect(c.score(0.85)).toBe('0.85');
    expect(c.success('ok')).toBe('ok');
    expect(c.error('fail')).toBe('fail');
    expect(c.dim('uri')).toBe('uri');
    expect(c.role('match')).toBe('match');
    expect(c.space('personal')).toBe('personal');
  });
});

describe('score color coding', () => {
  const origIsTTY = process.stdout.isTTY;
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('green for >= 0.7', () => {
    expect(c.score(0.85)).toContain('\x1b[32m'); // green
  });

  it('yellow for >= 0.4 and < 0.7', () => {
    expect(c.score(0.55)).toContain('\x1b[33m'); // yellow
  });

  it('red for < 0.4', () => {
    expect(c.score(0.2)).toContain('\x1b[31m'); // red
  });
});

describe('pretty renderers use colors', () => {
  const origIsTTY = process.stdout.isTTY;
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
  });
  it('renderActivatePretty includes ANSI codes', () => {
    const out: ActivateOutput = {
      must_obey: true,
      message: 'Pick one',
      next_action: 'forward',
      query: 'test',
      choices: [
        {
          uri: 'squadrules://adapter/test',
          label: 'Test Adapter',
          adapter_name: 'Test',
          activation_score: 0.85,
          tags: [],
          next_action: 'do thing',
          adapter_version: '1.0.0',
          space_name: 'personal',
          slug: 'test',
          role: 'match',
          forward_first_call: { uri: 'squadrules://adapter/test' },
        },
      ],
    };
    const rendered = renderActivatePretty(out);
    expect(rendered).toMatch(ANSI_RE);
    expect(rendered).toContain('activate:');
    expect(rendered).toContain('0.85');
  });

  it('renderSpacesPretty includes ASCII table and ANSI codes', () => {
    const out: SpacesOutput = {
      spaces: [
        { name: 'Personal', type: 'other', adapter_count: 0, space_id: 'space:personal' },
        { name: 'App', type: 'app', adapter_count: 5, space_id: 'space:app' },
      ],
    };
    const rendered = renderSpacesPretty(out);
    expect(rendered).toMatch(ANSI_RE);
    expect(rendered).toContain('─');
    expect(rendered).toContain('Personal');
    expect(rendered).toContain('App');
  });

  it('renderRewardPretty color-codes success vs failure', () => {
    const out: RewardOutput = {
      total_rated: 1,
      total_failed: 1,
      next_call: null,
      results: [
        {
          uri: 'squadrules://layer/00000000-0000-0000-0000-000000000001',
          outcome: 'success',
          score: 0.9,
          feedback: null,
          rater: null,
          rubric_version: null,
          llm_model_id: null,
          grader_kind: 'unknown',
          evaluation_label: 'gold',
          exportable_for_sft: false,
          exportable_for_preference: false,
          sft_blockers: [],
          preference_blockers: [],
          rated_at: '2026-01-01T00:00:00Z',
        },
        {
          uri: 'squadrules://layer/00000000-0000-0000-0000-000000000002',
          outcome: 'failure',
          score: 0.1,
          feedback: null,
          rater: null,
          rubric_version: null,
          llm_model_id: null,
          grader_kind: 'unknown',
          evaluation_label: 'rejected',
          exportable_for_sft: false,
          exportable_for_preference: false,
          sft_blockers: [],
          preference_blockers: [],
          rated_at: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const rendered = renderRewardPretty(out);
    expect(rendered).toMatch(ANSI_RE);
    expect(rendered).toContain('success');
    expect(rendered).toContain('failure');
  });

  it('renderForwardPretty includes ANSI codes', () => {
    const out: ForwardOutput = {
      must_obey: true,
      next_action: 'do thing',
      next_call: {
        kind: 'forward',
        args: {
          uri: 'squadrules://layer/00000000-0000-0000-0000-000000000010',
          solution_template: { type: 'comment', outcome: 'success', evidence: { text: 'ok' } },
        },
      },
      context_adapter_name: 'Test',
      current_layer_label: 'Step 1',
      adapter_layer_index: 1,
      adapter_layer_count: 3,
      contract: { type: 'comment' },
      message: 'Hello',
    };
    const rendered = renderForwardPretty(out);
    expect(rendered).toMatch(ANSI_RE);
    expect(rendered).toContain('forward:');
  });

  it('renderTrainPretty includes ANSI codes', () => {
    const out: TrainOutput = {
      status: 'stored',
      items: [{ label: 'Test', uri: 'squadrules://layer/00000000-0000-0000-0000-000000000099', tags: ['test'] }],
    };
    const rendered = renderTrainPretty(out);
    expect(rendered).toMatch(ANSI_RE);
    expect(rendered).toContain('train:');
    expect(rendered).toContain('stored');
  });
});
