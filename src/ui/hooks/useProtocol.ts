import { useQuery } from "@tanstack/react-query";
import type { ChallengePayload } from "@/components/ChallengeCard";
import { apiFetch } from "@/lib/api";
import type { ExportOutput } from "../../tools/export_schema.js";

/** Protocol editor / detail payload from markdown export. */
export interface ProtocolQueryData {
  content: string;
  uri: string;
  label: string;
  adapter_name: string | null;
  protocol_version?: string;
  space_id?: string | null;
  space_name?: string | null;
  space_type?: "personal" | "group" | "app" | "other";
}

async function fetchProtocol(uri: string): Promise<ProtocolQueryData> {
  const res = await apiFetch("/api/export", {
    method: "POST",
    body: JSON.stringify({ uri, format: "markdown" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { message?: string }).message ?? res.statusText;
    const e = new Error(msg) as Error & { statusCode?: number };
    e.statusCode = res.status;
    throw e;
  }
  const output = (await res.json()) as ExportOutput;
  return {
    content: output.content,
    uri: output.uri,
    label: output.adapter_name ?? "Adapter",
    adapter_name: output.adapter_name ?? null,
    ...(output.adapter_version ? { protocol_version: output.adapter_version } : {}),
    ...(output.space_id !== undefined && { space_id: output.space_id }),
    ...(output.space_name !== undefined && { space_name: output.space_name }),
    ...(output.space_type !== undefined && { space_type: output.space_type })
  };
}

export function useProtocol(uri: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["protocol", uri],
    queryFn: () => fetchProtocol(uri!),
    enabled: Boolean(uri && enabled),
  });
}

export interface ParsedStep {
  label: string;
  type: string;
  summary: string;
  /** Raw section body (for expand/copy). */
  body: string;
  /** Contract fields for {@link ChallengeCard} on protocol detail. */
  challengePayload?: ChallengePayload;
}

import type { ShellInterpreter } from '../../tools/shell-challenge-invocation.js';

/** Per-step form state for the protocol editor. */
export interface StepFormState {
  label: string;
  bodyMarkdown: string;
  type: "shell" | "mcp" | "user_input" | "comment";
  shell?: {
    cmd: string;
    timeout_seconds: number;
    interpreter?: ShellInterpreter;
    workdir?: string;
    flags: string[];
    args: string[];
  };
  mcp?: { tool_name: string };
  user_input?: { prompt: string };
  comment?: { min_length: number };
}

/** Form state for the full protocol editor. */
export interface ProtocolFormState {
  protocolLabel: string;
  triggersMarkdown: string;
  steps: StepFormState[];
  completionMarkdown: string;
}

/** Parse content into title, steps (label + contract type + body), activation patterns, and reward signal. */
export function parseProtocolMarkdown(md: string): {
  title: string;
  steps: ParsedStep[];
  triggers: string;
  completion: string;
} {
  const lines = md.split("\n");
  let title = "Protocol";
  const steps: ParsedStep[] = [];
  let triggers = "";
  let completion = "";

  const h1Match = lines.find((l) => l.startsWith("# "));
  if (h1Match) title = h1Match.replace(/^#\s+/, "").trim();

  const sections = md.split(/\n##\s+/);
  for (let i = 1; i < sections.length; i++) {
    const block = sections[i]!;
    const firstLine = block.split("\n")[0] ?? "";
    const heading = firstLine.trim();
    const body = block.slice(firstLine.length).replace(/^\n+/, "").trim();
    if (heading.toLowerCase().includes("activation pattern") || heading.toLowerCase().includes("natural language trigger")) {
      triggers = body.replace(/\n```json[\s\S]*?```/g, "").trim();
    } else if (heading.toLowerCase().includes("reward signal") || heading.toLowerCase().includes("completion rule")) {
      completion = body.replace(/\n```json[\s\S]*?```/g, "").trim();
    } else {
      const jsonMatch = body.match(/```json\s*([\s\S]*?)```/);
      let type = "comment";
      let summary = "Comment";
      let challengePayload: ChallengePayload | undefined;
      if (jsonMatch) {
        try {
          const obj = JSON.parse(jsonMatch[1]!.trim());
          const challenge = obj?.contract ?? obj?.challenge ?? obj;
          if (challenge?.type) type = String(challenge.type);
          if (type === "shell") {
            const cmd = challenge?.shell?.cmd ?? challenge?.cmd;
            const interp = challenge?.shell?.interpreter;
            summary = cmd
              ? interp
                ? `Shell (${interp}): ${String(cmd).slice(0, 60)}${String(cmd).length > 60 ? "…" : ""}`
                : `Shell: ${String(cmd).slice(0, 80)}${String(cmd).length > 80 ? "…" : ""}`
              : "Shell";
            if (cmd) challengePayload = { cmd: String(cmd) };
          } else if (type === "mcp") {
            const tool = challenge?.mcp?.tool_name;
            summary = tool ? `MCP: ${String(tool)}` : "MCP";
            if (tool) challengePayload = { tool_name: String(tool) };
          } else if (type === "user_input") {
            const prompt = challenge?.user_input?.prompt;
            summary = prompt ? `User input: ${String(prompt)}` : "User input";
            if (prompt) challengePayload = { prompt: String(prompt) };
          } else if (type === "tensor") {
            const name = challenge?.tensor?.output?.name;
            const outputType = challenge?.tensor?.output?.type;
            summary = name ? `Tensor: ${String(name)}${outputType ? ` (${String(outputType)})` : ""}` : "Tensor";
          } else if (type === "comment") {
            const min = challenge?.comment?.min_length;
            summary = min ? `Comment: min ${Number(min)} chars` : "Comment";
            if (min != null && !Number.isNaN(Number(min))) challengePayload = { min_length: Number(min) };
          } else {
            summary = String(type);
          }
        } catch {
          /* ignore */
        }
      }
      if (!summary) summary = String(type);
      steps.push({ label: heading, type, summary, body, challengePayload });
    }
  }
  return { title, steps, triggers, completion };
}

/** Parse markdown into form state for the protocol editor. */
export function parseProtocolMarkdownToForm(md: string): ProtocolFormState {
  const { title, steps, triggers, completion } = parseProtocolMarkdown(md);
  const stepStates: StepFormState[] = steps.map((step) => {
    const bodyMarkdown = step.body.replace(/\n```json\s*[\s\S]*?```\s*$/g, "").trim();
    let type: StepFormState["type"] = "comment";
    const stepState: StepFormState = { label: step.label, bodyMarkdown, type };
    const jsonMatch = step.body.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[1]!.trim());
        const challenge = obj?.contract ?? obj?.challenge ?? obj;
        if (challenge?.type && ["shell", "mcp", "user_input", "comment"].includes(String(challenge.type))) {
          type = challenge.type as StepFormState["type"];
          stepState.type = type;
        }
        if (type === "shell") {
          const sh = challenge?.shell;
          stepState.shell = {
            cmd: String(sh?.cmd ?? challenge?.cmd ?? "").trim(),
            timeout_seconds: Number(sh?.timeout_seconds ?? 30),
            interpreter: typeof sh?.interpreter === "string" ? sh.interpreter : undefined,
            workdir: typeof sh?.workdir === "string" ? sh.workdir : undefined,
            flags: Array.isArray(sh?.flags) ? sh.flags.map(String) : [],
            args: Array.isArray(sh?.args) ? sh.args.map(String) : [],
          };
        }
        else if (type === "mcp") stepState.mcp = { tool_name: String(challenge?.mcp?.tool_name ?? "").trim() };
        else if (type === "user_input") stepState.user_input = { prompt: String(challenge?.user_input?.prompt ?? "").trim() };
        else if (type === "comment") stepState.comment = { min_length: Number(challenge?.comment?.min_length ?? 10) };
      } catch {
        /* ignore */
      }
    }
    return stepState;
  });
  return {
    protocolLabel: title,
    triggersMarkdown: triggers,
    steps: stepStates,
    completionMarkdown: completion,
  };
}

/** Build markdown from protocol form state. */
export function buildMarkdownFromForm(state: ProtocolFormState): string {
  const lines: string[] = [];
  lines.push(`# ${state.protocolLabel.trim() || "Protocol"}`);
  lines.push("");
  lines.push("## Activation Patterns");
  lines.push("");
  lines.push(state.triggersMarkdown.trim() || "Describe when this protocol should run.");
  lines.push("");
  for (const step of state.steps) {
    lines.push(`## ${step.label.trim() || "Step"}`);
    lines.push("");
    lines.push(step.bodyMarkdown.trim() || "Step content.");
    const challenge: Record<string, unknown> = { type: step.type };
    if (step.type === "shell") {
      const shell: Record<string, unknown> = {
        cmd: step.shell?.cmd ?? "",
        timeout_seconds: step.shell?.timeout_seconds ?? 30,
      };
      const interp = step.shell?.interpreter?.trim();
      if (interp) shell.interpreter = interp;
      const wd = step.shell?.workdir?.trim();
      if (wd) shell.workdir = wd;
      if (step.shell?.flags?.length) shell.flags = step.shell.flags;
      if (step.shell?.args?.length) shell.args = step.shell.args;
      challenge.shell = shell;
    }
    else if (step.type === "mcp") challenge.mcp = { tool_name: step.mcp?.tool_name ?? "" };
    else if (step.type === "user_input") challenge.user_input = { prompt: step.user_input?.prompt ?? "" };
    else if (step.type === "comment") challenge.comment = { min_length: step.comment?.min_length ?? 10 };
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify({ contract: challenge }, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Reward Signal");
  lines.push("");
  lines.push(state.completionMarkdown.trim() || "Describe how this adapter should be rewarded when it completes.");
  return lines.join("\n");
}
