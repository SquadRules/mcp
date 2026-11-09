import crypto from 'node:crypto';
import type { Memory } from '../../types/memory.js';
import { CodeBlockProcessor } from '../code-block-processor.js';
import {
  parseMarkdownStructure,
  generateTags,
} from '../../utils/memory-store-utils.js';
import { extractInferenceContract, findAllLayerContractBlocks } from './adapter-contract-blocks.js';
/**
 * Sanitize H2 headings to remove STEP patterns and numbering that break layer order.
 * Transforms patterns like "## STEP 1 - Foo" or "## 3. Bar" into "## Foo" or "## Bar".
 *
 * A heading that carries nothing but its prefix ("## Step 1", "## 3.") is kept verbatim:
 * stripping the prefix would leave a bare "##", which is not a heading at all. That is a
 * silent content loss — the section loses its key, so the merge can neither inherit it
 * from a parent nor let a child override it (ADR 0043).
 */
function sanitizeHeading(line: string): string {
  if (!line.startsWith('## ')) return line;

  const sanitized = line
    .replace(/^##\s*STEP\s*\d+[:\s-–\-·•]*\s*/i, '## ')
    .replace(/^##\s*\d+[\s\.\)\-:—–\-·•]*\s*/i, '## ')
    .replace(/^##\s*[0-9]+[a-zA-Z]*[\s\.\)\-:—–\-·•]*\s*/i, '## ')
    .trim();

  return sanitized === '##' ? line.trim() : sanitized;
}

/**
 * Derive layer label from segment text: first H2 (## Title) in the segment, or fallback.
 */
function layerLabelFromSegment(segmentText: string, adapterTitle: string, layerIndex: number): string {
  const h2Match = segmentText.match(/^##\s+(.+)$/m);
  const title = h2Match?.[1];
  if (title) return title.trim();
  return adapterTitle || `Layer ${layerIndex + 1}`;
}

function extractActivationPatterns(sectionText: string): string[] {
  const lines = sectionText.split(/\r?\n/);
  let collecting = false;
  const collected: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+Activation Patterns\s*$/i.test(trimmed)) {
      collecting = true;
      continue;
    }
    if (collecting && /^##\s+/.test(trimmed)) {
      break;
    }
    if (collecting) {
      collected.push(line);
    }
  }

  return collected
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

function startsWithRewardSection(sectionText: string): boolean {
  const trimmed = sectionText.trimStart();
  return /^##\s+Reward Signal\s*(?:\r?\n|$)/i.test(trimmed);
}

function extractRewardSection(sectionText: string): string | null {
  const trimmed = sectionText.trim();
  if (!trimmed || !startsWithRewardSection(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Process a single H1 section into an adapter of layer memories. Layer
 * boundaries are defined by fenced contract blocks. H2 headings are used only
 * for layer labels when present in a segment.
 */
function processH1Section(
  h1Title: string,
  h1Content: string,
  llmModelId: string,
  now: Date,
  codeBlockProcessor: CodeBlockProcessor
): Memory[] {
  const blocks = findAllLayerContractBlocks(h1Content);
  const activationPatterns = extractActivationPatterns(h1Content);

  if (blocks.length === 0) {
    const { cleaned, contract } = extractInferenceContract(h1Content);
    const codeResult = codeBlockProcessor.processMarkdown(cleaned);
    const baseTags = generateTags(cleaned);
    const codeTags = codeResult.allIdentifiers.slice(0, 5);
    const allTags = [...baseTags, ...codeTags];
    const inferenceContract = contract
      ? { ...contract, required: contract.required ?? true }
      : undefined;
    const adapter: NonNullable<Memory['adapter']> = {
      id: '',
      name: h1Title,
      layer_index: 1,
      layer_count: 1,
      ...(activationPatterns.length > 0 && { activation_patterns: activationPatterns })
    };
    const singleMemory: any = {
      memory_uuid: crypto.randomUUID(),
      label: layerLabelFromSegment(cleaned, h1Title, 0),
      tags: allTags,
      text: cleaned,
      llm_model_id: llmModelId,
      created_at: now.toISOString(),
      adapter
    };
    if (inferenceContract) {
      singleMemory.inference_contract = inferenceContract;
    }
    return [singleMemory as Memory];
  }

  const nowIso = now.toISOString();
  const memories: Memory[] = [];
  let prevEnd = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const segmentText = h1Content.slice(prevEnd, block.start).trim();
    const cleaned = segmentText;
    const codeResult = codeBlockProcessor.processMarkdown(cleaned);
    const baseTags = generateTags(cleaned);
    const codeTags = codeResult.allIdentifiers.slice(0, 5);
    const allTags = [...baseTags, ...codeTags];
    const inferenceContract = {
      ...block.contract,
      required: block.contract.required ?? true
    };
    const adapter: NonNullable<Memory['adapter']> = h1Title
      ? {
          id: '',
          name: h1Title,
          layer_index: i + 1,
          layer_count: blocks.length,
          ...(activationPatterns.length > 0 && { activation_patterns: activationPatterns })
        }
      : {
          id: '',
          name: `Adapter ${i + 1}`,
          layer_index: i + 1,
          layer_count: blocks.length,
          ...(activationPatterns.length > 0 && { activation_patterns: activationPatterns })
        };
    memories.push({
      memory_uuid: crypto.randomUUID(),
      label: layerLabelFromSegment(cleaned, h1Title, i),
      tags: allTags,
      text: cleaned,
      llm_model_id: llmModelId,
      created_at: nowIso,
      adapter,
      inference_contract: inferenceContract
    } as Memory);
    prevEnd = block.end;
  }

  const trailing = h1Content.slice(prevEnd).trim();
  const rewardSection = extractRewardSection(trailing);
  if (trailing.length > 0 && !rewardSection) {
    const codeResult = codeBlockProcessor.processMarkdown(trailing);
    const baseTags = generateTags(trailing);
    const codeTags = codeResult.allIdentifiers.slice(0, 5);
    const allTags = [...baseTags, ...codeTags];
    const layerCount = memories.length + 1;
    memories.forEach(m => {
      if (m.adapter) m.adapter.layer_count = layerCount;
    });
    const adapter: NonNullable<Memory['adapter']> = h1Title
      ? {
          id: '',
          name: h1Title,
          layer_index: layerCount,
          layer_count: layerCount,
          ...(activationPatterns.length > 0 && { activation_patterns: activationPatterns })
        }
      : {
          id: '',
          name: `Adapter ${layerCount}`,
          layer_index: layerCount,
          layer_count: layerCount,
          ...(activationPatterns.length > 0 && { activation_patterns: activationPatterns })
        };
    memories.push({
      memory_uuid: crypto.randomUUID(),
      label: layerLabelFromSegment(trailing, h1Title, memories.length),
      tags: allTags,
      text: trailing,
      llm_model_id: llmModelId,
      created_at: nowIso,
      adapter
    } as Memory);
  } else {
    memories.forEach(m => {
      if (m.adapter) m.adapter.layer_count = memories.length;
    });
  }

  if (rewardSection) {
    memories.forEach((memory) => {
      if (memory.adapter) {
        memory.adapter.reward_signal = rewardSection;
      }
    });
  }

  return memories;
}

export function buildHeaderMemoryAdapter(markdownDoc: string, llmModelId: string, now: Date, codeBlockProcessor: CodeBlockProcessor): Memory[] {
  const cleanMarkdown = markdownDoc
    .split(/\r?\n/)
    .map(line => sanitizeHeading(line))
    .join('\n');

  const lines = cleanMarkdown.split(/\r?\n/);
  const h1Positions: Array<{ index: number; title: string }> = [];
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!inCodeBlock && trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      h1Positions.push({ index: i, title: trimmed.substring(2).trim() });
    }
  }

  if (h1Positions.length === 0) {
    const structure = parseMarkdownStructure(cleanMarkdown);
    if (structure.h2Items.length === 0) {
      return [];
    }
    const firstH2 = structure.h2Items[0] || '';
    return processH1Section(firstH2, cleanMarkdown, llmModelId, now, codeBlockProcessor);
  }

  const allMemories: Memory[] = [];

  for (let i = 0; i < h1Positions.length; i++) {
    const h1Start = h1Positions[i]!.index;
    const h1End = i < h1Positions.length - 1 ? h1Positions[i + 1]!.index : lines.length;
    const h1Title = h1Positions[i]!.title;

    const h1SectionLines = lines.slice(h1Start + 1, h1End);
    const h1Content = h1SectionLines.join('\n');

    const adapterMemories = processH1Section(h1Title, h1Content, llmModelId, now, codeBlockProcessor);
    allMemories.push(...adapterMemories);
  }
  return allMemories;
}
