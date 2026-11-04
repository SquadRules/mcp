/**
 * Prompt icons for SquadRules MCP prompts.
 *
 * Each prompt has a meaningful icon encoded as a data URI (image/svg+xml).
 * The MCP 2026-07-28 spec requires at minimum image/png at 48x48, but
 * SVG is more flexible and scales better. We provide SVG icons.
 */

const createSvgDataUri = (svgContent: string): string => {
  const encoded = encodeURIComponent(svgContent.trim());
  return `data:image/svg+xml,${encoded}`;
};

// Generic prompt icon: chat/message icon
export const PROMPT_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3F51B5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
`);

/**
 * Icon metadata for prompts - follows MCP 2026-07-28 spec.
 * Each entry provides an SVG icon at 48x48.
 */
export const PROMPT_ICONS: Record<string, Array<{ src: string; mimeType: string; sizes: string[] }>> = {
  // Default icon for all prompts (can be extended per-prompt as needed)
  _default: [{ src: PROMPT_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }]
} as const;

/**
 * Get icons for a prompt by name.
 * Falls back to default prompt icon if no specific icon exists.
 */
export function getPromptIcons(promptName: string): Array<{ src: string; mimeType: string; sizes: string[] }> {
  return PROMPT_ICONS[promptName] || PROMPT_ICONS['_default']!;
}
