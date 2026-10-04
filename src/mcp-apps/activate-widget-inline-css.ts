/**
 * Activate MCP App styles: shared chrome ({@link ./mcp-widget-chrome-inline-css.ts}) + choice list.
 */
import { MCP_WIDGET_CHROME_INLINE_CSS } from './mcp-widget-chrome-inline-css.js';
import { minifyInlineWidgetCss } from './widget-inline-minify.js';

const ACTIVATE_WIDGET_SPECIFIC_INLINE_CSS = `
    .brand.activate-brand-row {
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .activate-brand-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }
    .activate-brand-left .header-title {
      min-width: 0;
    }
    .header-top-match {
      flex-shrink: 0;
      max-width: 38%;
      text-align: right;
      line-height: 1.25;
    }
    .header-top-match-inner {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }
    .top-match-label {
      font-size: 0.72em;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--color-text-muted);
    }
    .top-match-pct {
      font-size: clamp(0.875rem, 2.4vw, 1.0625rem);
      font-weight: 600;
      letter-spacing: -0.015em;
      color: var(--color-text-muted);
    }
    .header-top-match[data-tier="4"] .top-match-pct,
    .pill[data-tier="4"] .pill-pct { color: #15803d; }
    html.dark .header-top-match[data-tier="4"] .top-match-pct,
    html.dark .pill[data-tier="4"] .pill-pct { color: #4ade80; }
    .header-top-match[data-tier="3"] .top-match-pct,
    .pill[data-tier="3"] .pill-pct { color: #16a34a; }
    html.dark .header-top-match[data-tier="3"] .top-match-pct,
    html.dark .pill[data-tier="3"] .pill-pct { color: #86efac; }
    .header-top-match[data-tier="2"] .top-match-pct,
    .pill[data-tier="2"] .pill-pct { color: #65a30d; }
    html.dark .header-top-match[data-tier="2"] .top-match-pct,
    html.dark .pill[data-tier="2"] .pill-pct { color: #bef264; }
    .header-top-match[data-tier="1"] .top-match-pct,
    .pill[data-tier="1"] .pill-pct { color: #ca8a04; }
    html.dark .header-top-match[data-tier="1"] .top-match-pct,
    html.dark .pill[data-tier="1"] .pill-pct { color: #fcd34d; }
    .waiting { opacity: 0.9; font-style: italic; color: var(--color-text-muted); }
    .choices-list { list-style: none; margin: 0; padding: 0; }
    .choices-list-more {
      margin-top: 4px;
      padding-top: 2px;
    }
    .activate-more-choices {
      margin: 6px 0 0 0;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      padding: 5px 8px;
    }
    .activate-more-choices summary {
      cursor: pointer;
      font-size: var(--font-size-xs);
      font-weight: 600;
      color: var(--color-text-muted);
      user-select: none;
    }
    .activate-more-choices[open] summary {
      margin-bottom: 4px;
    }
    .choice {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 6px 8px;
      margin-bottom: 6px;
      background: var(--color-surface);
    }
    #squadrules-activate-root #out {
      max-height: none;
      overflow: visible;
      flex: 0 1 auto;
    }
    .choice-row { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; margin-bottom: 2px; }
    .choice-row.choice-row-top {
      flex-wrap: nowrap;
      align-items: center;
      width: 100%;
      gap: 6px;
      margin-bottom: 4px;
    }
    .pill {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .pill .pill-pct {
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .pill[data-role="match"][data-tier] .pill-role {
      color: var(--color-text-muted);
    }
    .pill[data-role="match"] {
      background: color-mix(in srgb, var(--color-success) 14%, var(--color-surface-elevated));
      border-color: color-mix(in srgb, var(--color-success) 45%, var(--color-border));
      color: var(--color-success);
    }
    .pill[data-role="refine"] {
      background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-elevated));
      border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
      color: var(--color-accent);
    }
    .pill[data-role="create"] {
      background: color-mix(in srgb, var(--color-warning) 14%, var(--color-surface-elevated));
      border-color: color-mix(in srgb, var(--color-warning) 45%, var(--color-border));
      color: var(--color-warning);
    }
    .choice-space {
      margin-left: auto;
      font-size: 11px;
      font-weight: 500;
      color: var(--color-text-muted);
      text-align: right;
      max-width: 55%;
      min-width: 0;
      word-break: break-word;
      flex-shrink: 1;
      line-height: 1.3;
    }
    .choice-title-row {
      width: 100%;
    }
    .choice-title {
      display: block;
      width: 100%;
      font-weight: 600;
      line-height: 1.35;
      color: var(--color-text-heading);
    }
    .sub { font-size: 12px; color: var(--color-text-muted); margin: 2px 0; word-break: break-word; }
    .activate-json-summary {
      margin: 0 0 6px 0;
      color: var(--color-text-heading);
    }
    .activate-json-details {
      margin: 0;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      padding: 5px 8px;
    }
    .activate-json-details summary {
      cursor: pointer;
      font-size: var(--font-size-xs);
      font-weight: 600;
      color: var(--color-text-muted);
      user-select: none;
    }
    .activate-json-raw {
      margin: 6px 0 0 0;
      max-height: 220px;
      overflow: auto;
    }
`.trim();

export const ACTIVATE_WIDGET_INLINE_CSS =
  minifyInlineWidgetCss(MCP_WIDGET_CHROME_INLINE_CSS) + minifyInlineWidgetCss(ACTIVATE_WIDGET_SPECIFIC_INLINE_CSS);
