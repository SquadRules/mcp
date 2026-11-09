import { CodeBlockProcessor } from '../../src/services/code-block-processor.js';
import { buildHeaderMemoryAdapter } from '../../src/services/memory/adapter-builder.js';
import { buildProofMarkdown } from '../utils/proof-of-work.js';

describe('buildHeaderMemoryAdapter', () => {
  test('does not turn Reward Signal into an executable trailing layer', () => {
    const markdown = buildProofMarkdown('Two Step Adapter', [
      { heading: 'Step One', body: 'First body.', proofCmd: 'echo step1' },
      { heading: 'Step Two', body: 'Second body.', proofCmd: 'echo step2' }
    ]);

    const memories = buildHeaderMemoryAdapter(
      markdown,
      'test-adapter-builder',
      new Date('2026-03-23T00:00:00.000Z'),
      new CodeBlockProcessor()
    );

    expect(memories).toHaveLength(2);
    expect(memories[1]?.label).toBe('Step Two');
    expect(memories[memories.length - 1]?.text).toContain('Second body.');
    expect(memories[memories.length - 1]?.text).not.toContain('## Reward Signal');
    expect(memories[0]?.adapter?.reward_signal).toContain('## Reward Signal');
    expect(memories[0]?.adapter?.reward_signal).toContain('Only after all steps.');
  });
  test('keeps a numbered heading that has no name after its prefix', () => {
    const markdown = buildProofMarkdown('Numbered Heading Adapter', [
      { heading: 'Step 1', body: 'First body.' },
      { heading: '3.', body: 'Third body.' }
    ]);

    const memories = buildHeaderMemoryAdapter(
      markdown,
      'test-adapter-builder',
      new Date('2026-03-23T00:00:00.000Z'),
      new CodeBlockProcessor()
    );

    expect(memories).toHaveLength(2);
    // The heading survives, so the section stays addressable as an inheritance key.
    expect(memories[0]?.text).toContain('## Step 1');
    expect(memories[0]?.text).toContain('First body.');
    expect(memories[1]?.text).toContain('## 3.');
    expect(memories[1]?.text).toContain('Third body.');
  });
});
