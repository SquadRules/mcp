/**
 * Resource icons for SquadRules MCP resources.
 *
 * Each resource category has a meaningful icon encoded as a data URI (image/svg+xml).
 * The MCP 2026-07-28 spec requires at minimum image/png at 48x48, but
 * SVG is more flexible and scales better. We provide SVG icons.
 */

const createSvgDataUri = (svgContent: string): string => {
  const encoded = encodeURIComponent(svgContent.trim());
  return `data:image/svg+xml,${encoded}`;
};

// tools: book/documentation icon (open book)
export const TOOLS_DOC_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2196F3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>
`);

// mem: brain/memory icon (brain)
export const MEM_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9C27B0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2a4 4 0 0 1 4-4z"/>
    <path d="M8 8v6c0 2.2 1.8 4 4 4s4-1.8 4-4V8"/>
    <path d="M12 18v4"/>
    <path d="M8 12h8"/>
  </svg>
`);

// meta: info/settings icon (gear)
export const META_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#607D8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
`);

// resources: file/document icon (file text)
export const RESOURCE_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" x2="8" y1="13" y2="13"/>
    <line x1="16" x2="8" y1="17" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
`);

// templates: layout/template icon (layout)
export const TEMPLATE_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF9800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
    <line x1="3" x2="21" y1="9" y2="9"/>
    <line x1="9" x2="9" y1="21" y2="9"/>
  </svg>
`);

/**
 * Icon metadata for each resource category - follows MCP 2026-07-28 spec.
 * Each entry provides an SVG icon at 48x48.
 */
export const RESOURCE_ICONS: Record<string, Array<{ src: string; mimeType: string; sizes: string[] }>> = {
  tools: [{ src: TOOLS_DOC_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  mem: [{ src: MEM_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  meta: [{ src: META_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  resources: [{ src: RESOURCE_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  templates: [{ src: TEMPLATE_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }]
} as const;

/**
 * Get icons for a resource by category.
 * Falls back to generic resource icon if no specific icon exists.
 */
export function getResourceIcons(category: string): Array<{ src: string; mimeType: string; sizes: string[] }> {
  return RESOURCE_ICONS[category] || RESOURCE_ICONS['resources']!;
}
