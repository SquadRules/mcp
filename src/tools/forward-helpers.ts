import type { ForwardOutput } from './forward_schema.js';

export function buildEvidenceHint(contractType: string): string {
  switch (contractType) {
    case 'comment': return '.text = "<your verification summary>"';
    case 'shell': return '.exit_code = <exit code>, .stdout, .stderr';
    case 'mcp': return '.tool_name, .arguments, .response';
    case 'user_input': return '.confirmation = "<user reply>"';
    case 'subagent': return '.report = "<subagent delegation report>"';
    default: return '';
  }
}

export function buildEmptySolutionTemplate(contractType: ForwardOutput['contract']['type']): {
  type: ForwardOutput['contract']['type'];
  outcome: 'success';
  evidence: Record<string, unknown>;
} {
  const evidenceHints: Record<string, unknown> = (() => {
    switch (contractType) {
      case 'comment': return { text: '' };
      case 'shell': return { exit_code: 0 };
      case 'mcp': return { tool_name: '', arguments: {}, response: {} };
      case 'user_input': return { confirmation: '' };
      case 'subagent': return { report: '' };
      default: return {};
    }
  })();
  return { type: contractType, outcome: 'success', evidence: evidenceHints };
}
