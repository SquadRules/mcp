import { SQUADRULES_LOGO_SVG } from './squadrules-logo-embedded.js';
import { ACTIVATE_WIDGET_INLINE_CSS } from './activate-widget-inline-css.js';
import { ACTIVATE_WIDGET_INLINE_SCRIPT } from './activate-widget-inline-script.js';
import { minifyInlineWidgetHtml } from './widget-inline-minify.js';
import { substituteWidgetPresentationToken } from './mcp-widget-presentation-inject.js';

/**
 * MCP Apps HTML resource as a fragment (mount root + style + script), matching Confluence-style
 * widgets: the host supplies the document shell. Chrome aligns with {@link ./forward-widget-html.ts}.
 */
export function buildActivateWidgetHtml(): string {
  const logo = SQUADRULES_LOGO_SVG.replaceAll('`', '&#96;');
  return minifyInlineWidgetHtml(`<div id="squadrules-activate-root">
  <div class="brand activate-brand-row">
    <div class="activate-brand-left">
      ${logo}
      <h1 id="header-title" class="header-title"><span class="ht-brand">SQUADRULES</span><span class="ht-sep"> • </span><span class="ht-protocol-label">Activate • </span><span class="ht-protocol-name muted">…</span></h1>
    </div>
    <div id="header-top-match" class="header-top-match" role="status" aria-live="polite" hidden></div>
  </div>
  <div id="out"><span class="waiting">Loading activation results…</span></div>
</div>
<style>
${ACTIVATE_WIDGET_INLINE_CSS}
</style>
<script>
${substituteWidgetPresentationToken(ACTIVATE_WIDGET_INLINE_SCRIPT)}
</script>`);
}
