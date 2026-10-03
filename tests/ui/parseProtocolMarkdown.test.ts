// squadrules-compat-surface: dual-emits the kairos_local_artifact_dir JSON field expected by existing clients
import { describe, it, expect } from "vitest";
import {
  parseProtocolMarkdown,
  parseProtocolMarkdownToForm,
  buildMarkdownFromForm,
} from "@/hooks/useProtocol";

describe("parseProtocolMarkdown", () => {
  it("returns default title and empty steps for empty input", () => {
    const result = parseProtocolMarkdown("");
    expect(result.title).toBe("Protocol");
    expect(result.steps).toEqual([]);
    expect(result.triggers).toBe("");
    expect(result.completion).toBe("");
  });

  it("extracts H1 as title", () => {
    const result = parseProtocolMarkdown("# My Protocol Title\n\n");
    expect(result.title).toBe("My Protocol Title");
    expect(result.steps).toEqual([]);
  });

  it("parses Activation Patterns section", () => {
    const md = `# P

## Activation Patterns

deploy and test
`;
    const result = parseProtocolMarkdown(md);
    expect(result.triggers).toBe("deploy and test");
  });

  it("parses Reward Signal section", () => {
    const md = `# P

## Reward Signal

When all steps are done.
`;
    const result = parseProtocolMarkdown(md);
    expect(result.completion).toBe("When all steps are done.");
  });

  it("parses step with shell challenge type", () => {
    const md = `# P

## Step 1

Run the command.

\`\`\`json
{"contract": {"type": "shell", "shell": {"cmd": "npm test"}}}
\`\`\`
`;
    const result = parseProtocolMarkdown(md);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      label: "Step 1",
      type: "shell",
      summary: "Shell: npm test",
    });
    expect(result.steps[0]!.body).toContain("```json");
  });

  it("parses step with mcp challenge type", () => {
    const md = `# P

## Step 2

Call the tool.

\`\`\`json
{"contract": {"type": "mcp", "mcp": {"tool_name": "activate"}}}
\`\`\`
`;
    const result = parseProtocolMarkdown(md);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      label: "Step 2",
      type: "mcp",
      summary: "MCP: activate",
    });
  });

  it("parses step with user_input challenge type", () => {
    const md = `# P

## Confirm

Please confirm.

\`\`\`json
{"contract": {"type": "user_input", "user_input": {"prompt": "Proceed?"}}}
\`\`\`
`;
    const result = parseProtocolMarkdown(md);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      label: "Confirm",
      type: "user_input",
      summary: "User input: Proceed?",
    });
  });

  it("parses step with comment challenge type", () => {
    const md = `# P

## Comment step

Write a comment.

\`\`\`json
{"contract": {"type": "comment", "comment": {"min_length": 10}}}
\`\`\`
`;
    const result = parseProtocolMarkdown(md);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      label: "Comment step",
      type: "comment",
      summary: "Comment: min 10 chars",
    });
  });

  it("handles malformed JSON in code block", () => {
    const md = `# P

## Step

\`\`\`json
{ invalid json
\`\`\`
`;
    const result = parseProtocolMarkdown(md);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      label: "Step",
      type: "comment",
      summary: "Comment",
    });
  });

  it("strips json code blocks from triggers and completion", () => {
    const md = `# P

## Activation Patterns

Some text
\`\`\`json
{"x": 1}
\`\`\`
more text

## Reward Signal

Done.
`;
    const result = parseProtocolMarkdown(md);
    expect(result.triggers).not.toContain("```");
    expect(result.triggers).toContain("Some text");
    expect(result.triggers).toContain("more text");
    expect(result.completion).toBe("Done.");
  });

  it("parses multiple steps in order", () => {
    const md = `# Multi

## Step A

\`\`\`json
{"contract": {"type": "comment"}}
\`\`\`

## Step B

\`\`\`json
{"contract": {"type": "shell", "shell": {"cmd": "echo ok"}}}
\`\`\`
`;
    const result = parseProtocolMarkdown(md);
    expect(result.title).toBe("Multi");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.label).toBe("Step A");
    expect(result.steps[1]!.label).toBe("Step B");
    expect(result.steps[1]!.summary).toBe("Shell: echo ok");
  });
});

describe("parseProtocolMarkdownToForm and buildMarkdownFromForm", () => {
  it("round-trips protocol with triggers, steps, and completion", () => {
    const md = `# Deploy and test

## Activation Patterns

deploy and test
run tests and deploy

## Build

Run the build.

\`\`\`json
{"contract": {"type": "shell", "shell": {"cmd": "npm run build"}}}
\`\`\`

## Reward Signal

When each step is verified and the final reward is recorded.
`;
    const form = parseProtocolMarkdownToForm(md);
    expect(form.protocolLabel).toBe("Deploy and test");
    expect(form.triggersMarkdown).toContain("deploy and test");
    expect(form.steps).toHaveLength(1);
    expect(form.steps[0]!.label).toBe("Build");
    expect(form.steps[0]!.type).toBe("shell");
    expect(form.steps[0]!.shell?.cmd).toBe("npm run build");
    expect(form.steps[0]!.bodyMarkdown).toContain("Run the build");
    expect(form.completionMarkdown).toContain("When each step is verified");

    const rebuilt = buildMarkdownFromForm(form);
    expect(rebuilt).toContain("# Deploy and test");
    expect(rebuilt).toContain("## Activation Patterns");
    expect(rebuilt).toContain("## Build");
    expect(rebuilt).toContain("npm run build");
    expect(rebuilt).toContain("## Reward Signal");

    const reparsed = parseProtocolMarkdown(rebuilt);
    expect(reparsed.title).toBe(form.protocolLabel);
    expect(reparsed.steps.length).toBe(form.steps.length);
    expect(reparsed.steps[0]!.label).toBe(form.steps[0]!.label);
    expect(reparsed.steps[0]!.type).toBe("shell");
  });

  it("preserves empty challenge fields on round-trip (shell cmd, mcp tool_name, user_input prompt)", () => {
    const form = {
      protocolLabel: "Empty fields",
      triggersMarkdown: "test",
      steps: [
        {
          label: "Empty shell",
          bodyMarkdown: "TBD",
          type: "shell" as const,
          shell: { cmd: "", timeout_seconds: 30, flags: [], args: [] },
        },
        { label: "Empty mcp", bodyMarkdown: "TBD", type: "mcp" as const, mcp: { tool_name: "" } },
        { label: "Empty prompt", bodyMarkdown: "TBD", type: "user_input" as const, user_input: { prompt: "" } },
      ],
      completionMarkdown: "Done",
    };
    const rebuilt = buildMarkdownFromForm(form);
    expect(rebuilt).toContain('"cmd": ""');
    expect(rebuilt).toContain('"tool_name": ""');
    expect(rebuilt).toContain('"prompt": ""');
    const reparsedForm = parseProtocolMarkdownToForm(rebuilt);
    expect(reparsedForm.steps[0]!.shell?.cmd).toBe("");
    expect(reparsedForm.steps[1]!.mcp?.tool_name).toBe("");
    expect(reparsedForm.steps[2]!.user_input?.prompt).toBe("");
  });

  it("round-trips shell interpreter, flags, args, workdir", () => {
    const md = `# T

## Activation Patterns

When.

## Step one

Body.

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"die unless 1","interpreter":"perl","flags":["-e"],"timeout_seconds":5,"args":["x"],"workdir":"$KAIROS_LOCAL_ARTIFACT_DIR"},"required":true}}
\`\`\`

## Reward Signal

Done.
`;
    const form = parseProtocolMarkdownToForm(md);
    expect(form.steps[0]!.shell?.interpreter).toBe("perl");
    expect(form.steps[0]!.shell?.flags).toEqual(["-e"]);
    expect(form.steps[0]!.shell?.args).toEqual(["x"]);
    expect(form.steps[0]!.shell?.workdir).toBe("$KAIROS_LOCAL_ARTIFACT_DIR");
    const rebuilt = buildMarkdownFromForm(form);
    expect(rebuilt).toContain('"interpreter": "perl"');
    expect(rebuilt).toContain('"flags"');
    expect(rebuilt).toContain('"args"');
    expect(rebuilt).toContain('"workdir"');
  });
});
