/**
 * Tool icons for SquadRules MCP tools.
 *
 * Each tool has a meaningful icon encoded as a data URI (image/svg+xml).
 * The MCP 2026-07-28 spec requires at minimum image/png at 48x48, but
 * SVG is more flexible and scales better. We provide SVG icons.
 */

// Simple SVG icons for each tool - encoded as data URIs
const createSvgDataUri = (svgContent: string): string => {
  const encoded = encodeURIComponent(svgContent.trim());
  return `data:image/svg+xml,${encoded}`;
};

// activate: search/find icon (magnifying glass)
export const ACTIVATE_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4A90E2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <path d="m21 21-4.35-4.35"/>
  </svg>
`);

// forward: play/advance icon (arrow right)
export const FORWARD_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#50C878" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12h14"/>
    <path d="m12 5 7 7-7 7"/>
  </svg>
`);

// train: add/create icon (plus in circle)
export const TRAIN_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9B59B6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 8v8"/>
    <path d="M8 12h8"/>
  </svg>
`);

// reward: star/rating icon
export const REWARD_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#F39C12" stroke="#F39C12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
`);

// tune: edit/modify icon (pencil)
export const TUNE_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E67E22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    <path d="m15 5 4 4"/>
  </svg>
`);

// delete: trash/remove icon
export const DELETE_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E74C3C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18"/>
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    <line x1="10" x2="10" y1="11" y2="17"/>
    <line x1="14" x2="14" y1="11" y2="17"/>
  </svg>
`);

// export: download/output icon
export const EXPORT_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1ABC9C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" x2="12" y1="15" y2="3"/>
  </svg>
`);

// spaces: grid/layout icon
export const SPACES_ICON = createSvgDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3498DB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="14" rx="1"/>
    <rect width="7" height="7" x="3" y="14" rx="1"/>
  </svg>
`);

/**
 * Icon metadata for each tool - follows MCP 2026-07-28 spec.
 * Each entry provides an SVG icon at 48x48.
 */
export const TOOL_ICONS = {
  activate: [{ src: ACTIVATE_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  forward: [{ src: FORWARD_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  train: [{ src: TRAIN_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  reward: [{ src: REWARD_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  tune: [{ src: TUNE_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  delete: [{ src: DELETE_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  export: [{ src: EXPORT_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }],
  spaces: [{ src: SPACES_ICON, mimeType: 'image/svg+xml', sizes: ['48x48'] }]
} as const;
