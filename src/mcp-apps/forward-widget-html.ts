import { SQUADRULES_LOGO_SVG } from './squadrules-logo-embedded.js';
import { FORWARD_WIDGET_INLINE_CSS } from './forward-widget-inline-css.js';
import { FORWARD_WIDGET_INLINE_SCRIPT } from './forward-widget-inline-script.js';
import { minifyInlineWidgetHtml } from './widget-inline-minify.js';
import { substituteWidgetPresentationToken } from './mcp-widget-presentation-inject.js';

/**
 * MCP Apps HTML fragment for `forward` (mount root + style + script); host wraps a full document.
 * Same lifecycle as {@link ./spaces-mcp-app-widget-html.ts}.
 */
export function buildForwardWidgetHtml(): string {
  const logo = SQUADRULES_LOGO_SVG.replaceAll('`', '&#96;');
  return minifyInlineWidgetHtml(`<div id="squadrules-forward-root">
  <div class="brand">
    ${logo}
    <h1 id="header-title" class="header-title"><span class="ht-brand">SQUADRULES</span><span class="ht-sep"> • </span><span class="ht-protocol-label">Protocol:</span></h1>
  </div>
  <div id="out"><span class="waiting">Loading this forward step…</span></div>
  <footer id="run-footer" class="run-footer" hidden>
    <div class="footer-row">
      <div class="progress-wrap footer-progress">
        <div id="progress-segments" class="progress-segments" aria-hidden="true"></div>
      </div>
      <span id="step-text" class="step-label footer-step-count" role="status"></span>
    </div>
  </footer>
</div>
<style>
${FORWARD_WIDGET_INLINE_CSS}
</style>
<script>
${substituteWidgetPresentationToken(FORWARD_WIDGET_INLINE_SCRIPT)}
</script>`);
}
