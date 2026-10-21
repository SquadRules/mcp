export interface ProofStepDefinition {
  heading: string;
  body: string;
  proofCmd?: string;
  timeoutSeconds?: number;
}

function challengeBlock(cmd: string, timeoutSeconds: number): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `\n\n\`\`\`json\n{"contract":{"type":"shell","shell":{"cmd":"${esc(cmd)}","interpreter":"bash","timeout_seconds":${timeoutSeconds}},"required":true}}\n\`\`\``;
}

export function buildProofMarkdown(title: string, steps: ProofStepDefinition[]): string {
  const h1 = `# ${title}`;
  const triggers = '\n\n## Activation Patterns\n\nRun when user says run.';
  const sections = steps.map((step, index) => {
    const timeout = step.timeoutSeconds ?? 30;
    const cmd = step.proofCmd || `echo "step-${index + 1}"`;
    return `\n\n## ${step.heading}\n${step.body}${challengeBlock(cmd, timeout)}`;
  }).join('');
  const completionRule = '\n\n## Reward Signal\n\nOnly after all steps.';
  return `${h1}${triggers}${sections}${completionRule}`;
}

