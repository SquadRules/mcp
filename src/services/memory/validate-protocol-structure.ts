/**
 * Lightweight structural validation for adapter markdown before train.
 * Ensures required sections (Activation Patterns, Reward Signal) and at least
 * one ```json contract block. Rejects mixed-fence docs (plain ``` blocks with
 * contract) and validates each H1 section when multiple adapters are present.
 */

import { findAllLayerContractBlocks, hasPlainFenceLayerContractBlock } from './adapter-contract-blocks.js';
import type { InferenceContractDefinition } from '../../types/memory.js';
import { SHELL_INTERPRETERS } from '../../tools/shell-challenge-invocation.js';
export const CREATION_PROTOCOL_URI = 'squadrules://adapter/author-adapter';

export type ValidationResult = {
  valid: boolean;
  missing: string[];
  message: string;
};

const MISSING_ACTIVATION_PATTERNS = 'activation_patterns';
const MISSING_REWARD_SIGNAL = 'reward_signal';
const MISSING_H1 = 'h1_title';
const MISSING_CONTRACT_BLOCK = 'contract_block';
const MIXED_CONTRACT_FENCES = 'mixed_contract_fences';
const INVALID_CONTRACT_TYPE = 'invalid_contract_type';
/** A `shell` contract must name an interpreter from the allowed set (ADR 0026). */
const SHELL_INTERPRETER_REQUIRED = 'shell_interpreter_required';
/** An `mcp` contract must be a forward link to another adapter (ADR 0025). */
const MCP_LINK_ONLY = 'mcp_link_only';

const ALLOWED_CONTRACT_TYPES = new Set(['shell', 'mcp', 'user_input', 'comment', 'subagent']);

/** Interpreter values a `shell` contract may name (ADR 0026). */
const ALLOWED_SHELL_INTERPRETERS = new Set<string>(SHELL_INTERPRETERS);

/** Forward-link target an `mcp` contract must name (ADR 0025): squadrules://adapter/<slug>. */
const ADAPTER_FORWARD_LINK_URI = /^squadrules:\/\/adapter\/[^\s/]+$/;

/**
 * Per-type structural rules, expressed as data so a new contract type is a
 * table entry (plus a line in ALLOWED_CONTRACT_TYPES), not a validator rewrite.
 * `requiredFields` checks presence and, optionally, an allowed-value set;
 * `validate` covers shape rules beyond presence. Each yields the `missing` code
 * to report, or null when the contract is acceptable.
 */
type ContractTypePolicy = {
  requiredFields?: readonly {
    /** Dotted path relative to the contract, e.g. `shell.interpreter`. */
    path: string;
    /** `missing` code reported when the field is absent or not an allowed value. */
    code: string;
    /** When set, the trimmed string value must be a member. */
    allowedValues?: ReadonlySet<string>;
  }[];
  validate?: (contract: InferenceContractDefinition) => string | null;
};

const CONTRACT_TYPE_POLICIES: Record<string, ContractTypePolicy> = {
  shell: {
    requiredFields: [
      { path: 'shell.interpreter', code: SHELL_INTERPRETER_REQUIRED, allowedValues: ALLOWED_SHELL_INTERPRETERS },
    ],
  },
  mcp: {
    validate: (contract) => (isMcpForwardLink(contract) ? null : MCP_LINK_ONLY),
  },
  subagent: {},
  user_input: {},
  comment: {},
};

/** Read a dotted path off an untrusted contract without trusting its static type. */
function resolveContractPath(contract: InferenceContractDefinition, path: string): unknown {
  let current: unknown = contract;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** An `mcp` contract is valid only as a forward link to another adapter (ADR 0025). */
function isMcpForwardLink(contract: InferenceContractDefinition): boolean {
  const mcp = contract.mcp;
  if (!mcp || mcp.tool_name !== 'forward') return false;
  const uri = mcp.arguments?.['uri'];
  return typeof uri === 'string' && ADAPTER_FORWARD_LINK_URI.test(uri);
}

/** Run a type's policy; returns the first violated rule's `missing` code, or null. */
function validateContractAgainstPolicy(
  contract: InferenceContractDefinition,
  policy: ContractTypePolicy
): string | null {
  for (const field of policy.requiredFields ?? []) {
    const raw = resolveContractPath(contract, field.path);
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === undefined || value === null || value === '') return field.code;
    if (field.allowedValues && !(typeof value === 'string' && field.allowedValues.has(value))) {
      return field.code;
    }
  }
  return policy.validate ? policy.validate(contract) : null;
}

/**
 * Extract H1 and H2 headings from markdown, ignoring lines inside fenced code blocks.
 */
function extractHeadings(markdown: string): { h1: boolean; h2Titles: string[] } {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let fenceChar = '';
  let h1 = false;
  const h2Titles: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceChar = trimmed.slice(0, 3);
      } else if (trimmed.startsWith(fenceChar) || trimmed === '```') {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    if (/^#\s+/.test(line) && !/^##\s+/.test(line)) {
      h1 = true;
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match && h2Match[1]) {
      h2Titles.push(h2Match[1].trim());
    }
  }

  return { h1, h2Titles };
}

/**
 * Split markdown by H1 lines and return each section's H2 titles (for
 * multi-adapter validation).
 */
function extractH2TitlesPerH1Section(markdown: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  const sections: string[][] = [];
  let current: string[] = [];
  let seenH1 = false;
  let inFence = false;
  let fenceChar = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceChar = trimmed.slice(0, 3);
      } else if (trimmed.startsWith(fenceChar) || trimmed === '```') {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    if (/^#\s+/.test(line) && !/^##\s+/.test(line)) {
      if (seenH1) {
        sections.push(current);
      }
      seenH1 = true;
      current = [];
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match && h2Match[1]) {
      current.push(h2Match[1].trim());
    }
  }
  if (current.length > 0) {
    sections.push(current);
  }
  return sections;
}

/**
 * Validate adapter markdown structure before storeChain.
 * Returns { valid, missing, message } so train can return a
 * PROTOCOL_STRUCTURE_INVALID error with next_action.
 * When multiple H1 sections exist, each section must have first H2 =
 * Activation Patterns and last H2 = Reward Signal.
 */
export function validateProtocolStructure(markdownDoc: string): ValidationResult {
  const missing: string[] = [];
  const { h1, h2Titles } = extractHeadings(markdownDoc);

  if (!h1) {
    missing.push(MISSING_H1);
  }

  const sections = extractH2TitlesPerH1Section(markdownDoc);
  if (sections.length === 0 && h2Titles.length > 0) {
    sections.push(h2Titles);
  }
  if (sections.length === 0 && h1) {
    sections.push([]);
  }

  for (const h2TitlesOfSection of sections) {
    const firstH2 = h2TitlesOfSection[0] ?? '';
    const lastH2 = h2TitlesOfSection[h2TitlesOfSection.length - 1] ?? '';
    const firstOk = /^Activation Patterns$/i.test(firstH2.trim());
    if (!firstOk) {
      missing.push(MISSING_ACTIVATION_PATTERNS);
      break;
    }
    const lastOk = /^Reward Signal$/i.test(lastH2.trim());
    if (!lastOk) {
      missing.push(MISSING_REWARD_SIGNAL);
      break;
    }
  }

  if (hasPlainFenceLayerContractBlock(markdownDoc)) {
    missing.push(MIXED_CONTRACT_FENCES);
  }

  const contractBlocks = findAllLayerContractBlocks(markdownDoc);
  if (contractBlocks.length === 0) {
    missing.push(MISSING_CONTRACT_BLOCK);
  }

  const addMissingCode = (code: string): void => {
    if (!missing.includes(code)) missing.push(code);
  };

  for (const block of contractBlocks) {
    const t = block.contract.type;
    if (t === undefined) continue;
    if (typeof t !== 'string' || !ALLOWED_CONTRACT_TYPES.has(t)) {
      addMissingCode(INVALID_CONTRACT_TYPE);
      continue;
    }
    const policy = CONTRACT_TYPE_POLICIES[t];
    if (!policy) continue;
    const violation = validateContractAgainstPolicy(block.contract, policy);
    if (violation) addMissingCode(violation);
  }

  const valid = missing.length === 0;
  let message: string;
  if (valid) {
    message = '';
  } else {
    const parts = missing.map(m => {
      if (m === MISSING_H1) return 'H1 title';
      if (m === MISSING_ACTIVATION_PATTERNS) {
        return 'Activation Patterns (first H2)';
      }
      if (m === MISSING_REWARD_SIGNAL) return 'Reward Signal (last H2)';
      if (m === MISSING_CONTRACT_BLOCK) return 'at least one ```json contract block';
      if (m === MIXED_CONTRACT_FENCES) {
        return 'use only ```json for contract blocks (no plain ``` with contract JSON)';
      }
      if (m === INVALID_CONTRACT_TYPE) {
        return 'each ```json block must set type to exactly shell, mcp, user_input, comment, or subagent (no placeholders or combined values)';
      }
      if (m === SHELL_INTERPRETER_REQUIRED) {
        return 'shell contracts must set shell.interpreter to one of bash, sh, python3, python, or node';
      }
      if (m === MCP_LINK_ONLY) {
        return 'mcp contracts must be a forward link to another adapter (mcp.tool_name "forward" with mcp.arguments.uri = squadrules://adapter/<slug>)';
      }
      return m;
    });
    message = `Adapter is missing required structure: ${parts.join(', ')}. Run the creation adapter flow for guided help.`;
  }

  return { valid, missing, message };
}
