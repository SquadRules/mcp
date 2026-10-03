// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import {
  KAIROS_CREATION_PROTOCOL_SLUG,
  KAIROS_REFINING_PROTOCOL_SLUG,
  memoryIsBuiltinSearchFooterProtocol
} from '../../src/constants/builtin-search-meta.js';
import type { Memory } from '../../src/types/memory.js';

function mem(partial: Partial<Memory> & Pick<Memory, 'memory_uuid'>): Memory {
  return {
    label: 'x',
    tags: [],
    text: '',
    llm_model_id: 'm',
    created_at: new Date().toISOString(),
    ...partial
  };
}

describe('memoryIsBuiltinSearchFooterProtocol', () => {
  it('detects refine protocol by slug', () => {
    expect(
      memoryIsBuiltinSearchFooterProtocol(
        mem({ memory_uuid: 'some-uuid', slug: KAIROS_REFINING_PROTOCOL_SLUG })
      )
    ).toBe(true);
  });

  it('detects creation protocol by slug', () => {
    expect(
      memoryIsBuiltinSearchFooterProtocol(
        mem({ memory_uuid: 'some-uuid', slug: KAIROS_CREATION_PROTOCOL_SLUG })
      )
    ).toBe(true);
  });

  it('returns false for ordinary memories', () => {
    expect(
      memoryIsBuiltinSearchFooterProtocol(
        mem({ memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
      )
    ).toBe(false);
    expect(
      memoryIsBuiltinSearchFooterProtocol(
        mem({
          memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          slug: 'some-other-slug',
          adapter: { id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', name: 'C', layer_index: 1, layer_count: 1 }
        })
      )
    ).toBe(false);
  });
});
