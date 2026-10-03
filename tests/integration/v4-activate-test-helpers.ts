/**
 * Shared helpers for v4-squadrules-activate integration tests.
 * Relies on Jest-injected `expect` (no @jest/globals import — blocked in tests/integration).
 */
import { parseMcpJson } from '../utils/expect-with-raw.js';
import { AUTHOR_SLUG_RE, MAX_PROTOCOL_SLUG_LENGTH } from '../../src/utils/protocol-slug.js';

export type ParsedActivate = ReturnType<typeof parseMcpJson>;

export type ActivateChoice = {
  uri: string;
  label: unknown;
  adapter_name: unknown;
  activation_score: unknown;
  role: string;
  tags: unknown;
  slug: unknown;
  next_action?: unknown;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function expectConfidencePercentInMessage(message: string): void {
  const match = message.match(/top confidence:\s*(\d+)%/i);
  if (!match) return;
  const pct = Number(match[1]);
  expect(Number.isFinite(pct)).toBe(true);
  expect(pct).toBeGreaterThanOrEqual(0);
  expect(pct).toBeLessThanOrEqual(100);
}

/**
 * Match rows may be `null` when no slug is stored — use train+echo test to prove slug plumbing.
 * Create footer rows include the built-in creation adapter slug (`create-new-protocol`), not null.
 */
export function expectActivateChoiceSlugField(choice: ActivateChoice): void {
  expect(choice.slug === null || typeof choice.slug === 'string').toBe(true);

  if (choice.role === 'create') {
    if (choice.slug === null) return;
    const slug = choice.slug as string;
    expect(slug.length).toBeGreaterThan(0);
    expect(slug.length).toBeLessThanOrEqual(MAX_PROTOCOL_SLUG_LENGTH);
    expect(slug).toBe(slug.trim());
    expect(slug).toMatch(AUTHOR_SLUG_RE);
    return;
  }

  if (choice.role !== 'match' && choice.role !== 'refine') {
    throw new Error(`unexpected activate choice role: ${String(choice.role)}`);
  }

  if (choice.slug === null) {
    return;
  }

  const slug = choice.slug as string;
  expect(slug.length).toBeGreaterThan(0);
  expect(slug.length).toBeLessThanOrEqual(MAX_PROTOCOL_SLUG_LENGTH);
  expect(slug).toBe(slug.trim());
  expect(slug).toMatch(AUTHOR_SLUG_RE);
}

export function expectNoDeprecatedTopLevelFields(parsed: ParsedActivate): void {
  expect(parsed.start_here).toBeUndefined();
  expect(parsed.best_match).toBeUndefined();
  expect(parsed.protocol_status).toBeUndefined();
  expect(parsed.suggestion).toBeUndefined();
  expect(parsed.hint).toBeUndefined();
}

export function nextActionLooksActionable(next: string): boolean {
  return (
    next.includes("choice's next_action") ||
    next.includes('squadrules://') ||
    next.toLowerCase().includes('forward')
  );
}
