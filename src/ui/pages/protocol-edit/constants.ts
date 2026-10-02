// squadrules-compat-surface: dual-accepts canonical kairos:// URIs alongside squadrules:// so existing stored URIs keep resolving
import { z } from "zod";
import type { StepFormState } from "@/hooks/useProtocol";

export const markdownSchema = z
  .string()
  .min(1, "Protocol content is required")
  .refine((s) => s.includes("# "), "Protocol must have an H1 title")
  .refine((s) => /(^|\n)##\s+Activation Patterns\b/i.test(s), 'Include an "Activation Patterns" section (H2)')
  .refine((s) => /(^|\n)##\s+Reward Signal\b/i.test(s), 'Include a "Reward Signal" section (H2)');

export const DEFAULT_STEP: StepFormState = {
  label: "Step",
  bodyMarkdown: "What the user or agent does in this step.",
  type: "comment",
  comment: { min_length: 10 },
};

export const CHALLENGE_TYPE_KEYS: StepFormState["type"][] = ["shell", "mcp", "user_input", "comment"];

export const SOURCE_ADAPTER_URI_RE = /^(?:kairos|squadrules):\/\/adapter\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
