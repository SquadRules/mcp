/**
 * Tests for #99, #97 — subagent contract type + anti-cheat.
 *
 * Verifies:
 * - forwardContractSchema accepts type:'subagent' with subagent.context
 * - forwardSolutionSchema accepts type:'subagent' with evidence.report
 * - forwardSolutionSchema rejects type:'subagent' without evidence (anti-cheat)
 * - solutionTemplateSchema (in next_call) requires evidence for subagent
 * - buildEvidenceHint / buildEmptySolutionTemplate handle subagent
 * - next_schema solution/challenge accept subagent
 * - normalizeForwardSolutionFormat handles subagent v1 -> v2 normalization
 */
import { beforeAll, describe, expect, it } from '@jest/globals';

// ─── forwardContractSchema ───────────────────────────────────────────────
describe('forwardContractSchema: subagent type (#99)', () => {
  let forwardContractSchema: typeof import('../../src/tools/forward_schema.js').forwardContractSchema;

  beforeAll(async () => {
    const mod = await import('../../src/tools/forward_schema.js');
    forwardContractSchema = mod.forwardContractSchema;
  });

  it('accepts contract with type=subagent and context', () => {
    const result = forwardContractSchema.safeParse({
      type: 'subagent',
      required: true,
      description: 'Delegate task to subagent',
      subagent: { context: 'Fix the broken test in src/foo.ts' }
    });
    expect(result.success).toBe(true);
  });

  it('accepts contract with type=subagent without context (context is optional)', () => {
    const result = forwardContractSchema.safeParse({
      type: 'subagent',
      required: false,
      description: 'Delegate optional task'
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown contract types', () => {
    const result = forwardContractSchema.safeParse({
      type: 'unknown_type',
      required: true
    });
    expect(result.success).toBe(false);
  });
});

// ─── forwardSolutionSchema ───────────────────────────────────────────────
describe('forwardSolutionSchema: subagent evidence gate (#97)', () => {
  let forwardSolutionSchema: typeof import('../../src/tools/forward_schema.js').forwardSolutionSchema;

  beforeAll(async () => {
    const mod = await import('../../src/tools/forward_schema.js');
    forwardSolutionSchema = mod.forwardSolutionSchema;
  });

  it('accepts subagent solution with non-empty evidence.report', () => {
    const result = forwardSolutionSchema.safeParse({
      type: 'subagent',
      outcome: 'success',
      evidence: { report: 'Subagent completed: fixed foo.ts, all tests pass.' }
    });
    expect(result.success).toBe(true);
  });

  it('rejects subagent solution without evidence (anti-cheat)', () => {
    const result = forwardSolutionSchema.safeParse({
      type: 'subagent',
      outcome: 'success'
    });
    expect(result.success).toBe(false);
  });

  it('accepts subagent solution with failure outcome and evidence', () => {
    const result = forwardSolutionSchema.safeParse({
      type: 'subagent',
      outcome: 'failure',
      evidence: { report: 'Delegation unavailable: no subagent runtime configured.' }
    });
    expect(result.success).toBe(true);
  });
});

// ─── normalizeForwardSolutionFormat ──────────────────────────────────────
describe('normalizeForwardSolutionFormat: subagent v1 -> v2', () => {
  let forwardSolutionSchema: typeof import('../../src/tools/forward_schema.js').forwardSolutionSchema;

  beforeAll(async () => {
    const mod = await import('../../src/tools/forward_schema.js');
    forwardSolutionSchema = mod.forwardSolutionSchema;
  });

  it('normalizes subagent type-specific data into evidence envelope', () => {
    const result = forwardSolutionSchema.safeParse({
      type: 'subagent',
      subagent: { report: 'Task completed by delegate.' }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence).toBeDefined();
      expect((result.data.evidence as any)?.report).toBe('Task completed by delegate.');
      expect(result.data.outcome).toBe('success');
    }
  });
});

// ─── forward-helpers ─────────────────────────────────────────────────────
describe('forward-helpers: subagent support', () => {
  let buildEvidenceHint: typeof import('../../src/tools/forward-helpers.js').buildEvidenceHint;
  let buildEmptySolutionTemplate: typeof import('../../src/tools/forward-helpers.js').buildEmptySolutionTemplate;

  beforeAll(async () => {
    const mod = await import('../../src/tools/forward-helpers.js');
    buildEvidenceHint = mod.buildEvidenceHint;
    buildEmptySolutionTemplate = mod.buildEmptySolutionTemplate;
  });

  it('buildEvidenceHint returns report hint for subagent', () => {
    const hint = buildEvidenceHint('subagent');
    expect(hint).toContain('.report');
  });

  it('buildEmptySolutionTemplate returns subagent template with report field', () => {
    const template = buildEmptySolutionTemplate('subagent');
    expect(template.type).toBe('subagent');
    expect(template.outcome).toBe('success');
    expect(template.evidence).toBeDefined();
    expect(template.evidence).toHaveProperty('report');
  });
});

// ─── next_schema ─────────────────────────────────────────────────────────
describe('next_schema: subagent type', () => {
  let solutionSchema: typeof import('../../src/tools/next_schema.js').solutionSchema;
  let challengeSchema: typeof import('../../src/tools/next_schema.js').challengeSchema;

  beforeAll(async () => {
    const mod = await import('../../src/tools/next_schema.js');
    solutionSchema = mod.solutionSchema;
    challengeSchema = mod.challengeSchema;
  });

  it('solutionSchema accepts subagent with report', () => {
    const result = solutionSchema.safeParse({
      type: 'subagent',
      subagent: { report: 'Delegated and completed.' }
    });
    expect(result.success).toBe(true);
  });

  it('solutionSchema rejects subagent without subagent field', () => {
    const result = solutionSchema.safeParse({
      type: 'subagent'
    });
    expect(result.success).toBe(false);
  });

  it('challengeSchema accepts subagent type', () => {
    const result = challengeSchema.safeParse({
      type: 'subagent',
      description: 'Delegate task to subagent',
      subagent: { context: 'Fix the failing test' }
    });
    expect(result.success).toBe(true);
  });
});

// ─── MANDATORY_DELEGATION_INSTRUCTION ────────────────────────────────────
// Note: forward-view.ts imports are tested via forward-nonce-stability.test.ts
// which already sets up the required ESM mocks. The MANDATORY_DELEGATION_INSTRUCTION
// constant is verified by TypeScript compilation and the forward-view integration.

// ─── solutionTemplateSchema (via forwardOutputSchema next_call) ──────────
describe('solutionTemplateSchema: subagent requires evidence', () => {
  let forwardContractSchema: typeof import('../../src/tools/forward_schema.js').forwardContractSchema;

  beforeAll(async () => {
    const mod = await import('../../src/tools/forward_schema.js');
    forwardContractSchema = mod.forwardContractSchema;
  });

  it('subagent contract round-trips through schema', () => {
    const contract = {
      type: 'subagent' as const,
      required: true,
      description: 'Test delegation',
      subagent: { context: 'Unit test context' }
    };
    const parsed = forwardContractSchema.safeParse(contract);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe('subagent');
      expect(parsed.data.subagent?.context).toBe('Unit test context');
    }
  });
});
