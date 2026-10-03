import { apiFetch } from "@/lib/api";
import type { ExportOutput } from "../../tools/export_schema.js";

/** Result of downloading a skill ZIP from a JSON `download_ref` or explicit inline base64. */
export type SkillZipDownloadResult = {
  blob: Blob;
  /** JSON string of manifest when available. */
  skill_bundle_manifest?: string;
};

/** Request a server-built skill ZIP for a single adapter or layer URI. */
export async function fetchSkillZipBundle(uri: string): Promise<SkillZipDownloadResult> {
  const res = await apiFetch("/api/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uri, format: "skill_zip" }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    const msg = err.message ?? res.statusText;
    throw new Error(msg);
  }
  const json = (await res.json()) as ExportOutput;
  if (json.format === "skill_zip" && json.download_ref?.url) {
    const downloadRes = await fetch(json.download_ref.url, { credentials: "same-origin" });
    if (!downloadRes.ok) {
      throw new Error(`Download failed: ${downloadRes.statusText}`);
    }
    return {
      blob: await downloadRes.blob(),
      skill_bundle_manifest: json.skill_bundle_manifest,
    };
  }
  if (json.format !== "skill_zip" || json.content_encoding !== "base64") {
    throw new Error("Expected a skill_zip export with download_ref or base64-encoded content.");
  }
  const blob = base64ToBlob(json.content, json.content_type || "application/zip");
  return { blob, skill_bundle_manifest: json.skill_bundle_manifest };
}

export function base64ToBlob(b64: string, contentType: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Prefer first skill slug from manifest; fall back to `fallbackBase`. */
export function suggestedSkillZipFilename(
  manifestJson: string | undefined,
  fallbackBase: string
): string {
  try {
    if (manifestJson) {
      const m = JSON.parse(manifestJson) as { skills?: Array<{ slug?: string }> };
      const s = m.skills?.[0]?.slug;
      if (s && s.length > 0) return `${s}-squadrules-skill.zip`;
    }
  } catch {
    /* ignore */
  }
  const safe = fallbackBase.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "squadrules-skill";
  return `${safe}-squadrules-skill.zip`;
}
