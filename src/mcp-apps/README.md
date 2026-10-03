# `src/mcp-apps/` — SQUADRULES MCP Apps Widgets

Agent-facing guide for developing, maintaining, and debugging MCP Apps widgets
in this codebase.

<!-- squadrules-doc-keep: directory-local widget implementation detail (file layout, IIFE pattern, ESLint rules); the wiki "Web Interface" topic covers user-facing UI, not this source-tree how-to -->

## What are MCP Apps?

MCP Apps (SEP-1865 / `@modelcontextprotocol/ext-apps`) let an MCP server
deliver interactive HTML UIs alongside tool results. The host (Cursor, Claude
Desktop, etc.) renders the HTML inside a sandboxed iframe and bridges data to
it via `postMessage`.

**Two-part registration:**

1. **Tool** — called by the LLM; returns `structuredContent` (data).
   Its `_meta.ui.resourceUri` tells the host which resource to render.
2. **Resource** — serves an HTML fragment; the host wraps it in a document
   shell and delivers the tool result to it via `ui/notifications/tool-result`.

## Source material for agents

When you need official API docs or spec details, query these Context7 libraries:

| Context7 library ID | What it covers |
|---|---|
| `/modelcontextprotocol/ext-apps` | MCP Apps SDK, spec, lifecycle, `registerAppTool`, `registerAppResource`, CSP, host-context, patterns |
| `/modelcontextprotocol/typescript-sdk` | `McpServer`, `server.registerTool`, `server.registerResource`, transports |

Clone the SDK for working examples:

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" \
  --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
```

Key reference paths inside the clone:

| Path | Contents |
|---|---|
| `src/app.ts` | `App` class, `ontoolresult`, `ontoolinput`, `onhostcontextchanged` |
| `src/server/index.ts` | `registerAppTool`, `registerAppResource` |
| `src/spec.types.ts` | Type definitions, `McpUiHostContext`, CSS variable names |
| `src/styles.ts` | `applyDocumentTheme`, `applyHostStyleVariables` |
| `docs/patterns.md` | Polling, chunked responses, fullscreen, CSP, streaming input |
| `examples/basic-server-vanillajs/` | Minimal vanilla JS MCP App (closest to SQUADRULES pattern) |

## MCP Apps lifecycle (the handshake)

```
Host creates iframe → loads resource HTML
Widget  →  Host:  { jsonrpc:"2.0", id:1, method:"ui/initialize", params:{ appInfo, protocolVersion } }
Host    →  Widget: { jsonrpc:"2.0", id:1, result:{ hostContext } }
Widget  →  Host:  { jsonrpc:"2.0", method:"ui/notifications/initialized", params:{} }
Host    →  Widget: { jsonrpc:"2.0", method:"ui/notifications/tool-input", params:{ arguments } }
Host    →  Widget: { jsonrpc:"2.0", method:"ui/notifications/tool-result", params:{ structuredContent, content } }
Widget  →  Host:  { jsonrpc:"2.0", method:"ui/notifications/size-changed", params:{ height } }
```

1. Widget sends `ui/initialize` request via `window.parent.postMessage`.
2. Host responds with `hostContext` (theme, styles, fonts).
3. Widget sends `ui/notifications/initialized` notification.
4. Host sends `ui/notifications/tool-input` with the tool's input arguments.
5. Host delivers the tool result via `ui/notifications/tool-result`.
6. Widget renders the data.
7. Widget sends `ui/notifications/size-changed` so the host can resize the
   iframe to fit the content without internal scrolling.

All messages use JSON-RPC 2.0 over `postMessage`. The widget **must** handle
both `ui/notifications/tool-result` and the older `notifications/tool-result`
method names for older host support.

## SQUADRULES widget architecture

SQUADRULES widgets use **vanilla JS inlined in a single HTML fragment** — no
framework, no build step for the client side. The server assembles the fragment
at resource-read time from three TypeScript string exports:

```
*-widget-html.ts        →  buildXxxWidgetHtml()    assembles the fragment
*-widget-inline-css.ts  →  XXX_WIDGET_INLINE_CSS   CSS string
*-widget-inline-script.ts → XXX_WIDGET_INLINE_SCRIPT  JS string (IIFE)
```

### File layout per widget

| File | Role |
|---|---|
| `{name}-widget-html.ts` | Assembles `<div>` + `<style>` + `<script>` into one HTML fragment |
| `{name}-widget-inline-css.ts` | Widget-specific CSS (imports `MCP_WIDGET_CHROME_INLINE_CSS` for shared tokens) |
| `{name}-widget-inline-script.ts` | Self-contained IIFE — lifecycle, `postMessage`, rendering |
| `register-{name}-ui-resources.ts` | Calls `server.registerResource()` for both MCP App and Skybridge MIME profiles |

### Shared modules

| File | Role |
|---|---|
| `squadrules-ui-constants.ts` | URIs (`ui://squadrules/*`), `_meta` objects, MIME types |
| `mcp-widget-chrome-inline-css.ts` | Shared CSS tokens and layout (colors, typography, dark mode) |
| `mcp-widget-presentation-inject.ts` | Injects `SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY` flag into scripts |
| `squadrules-server-ui-capability.ts` | Server `extensions` block advertised on `initialize` |
| `squadrules-logo-embedded.ts` | Inline SVG logo |
| `list-offerings-for-ui.ts` | Builds the combined tools + resources + prompts listing for UI discovery |

### Registration flow (server side)

In `src/server.ts`, each widget is wired in two steps:

```typescript
// 1. Tool registration — _meta.ui.resourceUri links tool to widget
server.registerTool('forward', {
  _meta: SQUADRULES_FORWARD_TOOL_UI_META,  // { ui: { resourceUri: 'ui://squadrules/forward-result' } }
  ...
}, handler);

// 2. Resource registration — serves the HTML fragment
registerForwardUiResources(server);
```

### Dual MIME profiles

Every widget is registered twice — once with `text/html;profile=mcp-app` (MCP
Apps spec) and once with `text/html+skybridge` (OpenAI/Skybridge profile) — to
maximize host compatibility:

| URI scheme | MIME type | Profile |
|---|---|---|
| `ui://squadrules/{name}-result` | `text/html;profile=mcp-app` | MCP Apps (Cursor, Claude Desktop) |
| `ui://open-ai/squadrules/{name}-result` | `text/html+skybridge` | Skybridge (ChatGPT, Windsurf) |

## Widget script pattern (vanilla JS IIFE)

Every inline script follows this structure:

```javascript
(function () {
  // DOM refs
  var el = document.getElementById('out');

  // JSON-RPC / widget contract version constants
  var PROTO = '2026-01-26';
  var nextId = 1;
  var pending = {};
  var hostCtxState = {};
  var PRESENTATION_ONLY = __SQUADRULES_WIDGET_PRESENTATION_ONLY__;

  // Message listener — route JSON-RPC 2.0 messages
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.jsonrpc !== '2.0') return;

    // Pending request responses
    if (d.id != null && pending[d.id]) { /* resolve/reject */ return; }

    // Host context changes
    if (d.method === 'ui/notifications/host-context-changed') { /* apply theme */ return; }

    // Tool result delivery
    if (d.method === 'ui/notifications/tool-result') { applyToolResult(d.params); return; }
    if (d.method === 'notifications/tool-result') { applyToolResult(d.params); return; }
  });

  // postMessage helpers
  function post(msg) { window.parent.postMessage(msg, '*'); }
  function sendRequest(method, params, timeoutMs) { /* returns Promise */ }
  function sendNotification(method, params) { /* fire-and-forget */ }

  // Tell the host how tall the content is so it can resize the iframe
  function notifySize() {
    requestAnimationFrame(function () {
      var h = document.documentElement.scrollHeight;
      sendNotification('ui/notifications/size-changed', { height: h });
    });
  }

  // Data rendering — call notifySize() after every render path
  function applyToolResult(p) { /* parse structuredContent or content[0].text, render, notifySize() */ }

  // Boot — initiate handshake
  function boot() {
    if (PRESENTATION_ONLY) { /* show placeholder */ return; }
    sendRequest('ui/initialize', { appInfo: {...}, protocolVersion: PROTO })
      .then(function (result) {
        // Apply host context (theme, fonts)
        sendNotification('ui/notifications/initialized', {});
      })
      .catch(function (err) { /* show error fallback */ });
  }

  boot();
})();
```

### Dark mode / host theming

Widgets receive theme data through two mechanisms:

1. `ui/initialize` response includes `result.hostContext` with theme and CSS
   variables.
2. `ui/notifications/host-context-changed` delivers delta updates at runtime.

The `mergeHostContextDelta()` + `paintHostContext()` functions apply these to
`:root` CSS variables and `data-theme` attributes.

### `PRESENTATION_ONLY` mode

Set `SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY=true` in the server environment to
disable all `postMessage` bridge calls. Widgets show a static placeholder
instead. Useful for:
- Diagnosing host-side crashes (isolates whether the widget's JS is the cause)
- Testing HTML/CSS rendering without a live host

## ESLint rules for widgets

### `squadrules-mcp-widget/handshake-and-safety`

Widget inline script files (`*-widget-inline-script.ts`) must contain both
`ui/initialize` and `ui/notifications/initialized` strings. The ESLint rule
`squadrules-mcp-widget/handshake-and-safety` enforces this to guarantee host
compatibility. Do not remove the handshake even during debugging — use the
`PRESENTATION_ONLY` flag to bypass it at runtime instead.

### `max-lines`

Widget script files have a `max-lines` override in `eslint/flat-config.cjs`
(currently 520 lines). Keep scripts concise — extract shared logic into
`mcp-widget-chrome-inline-css.ts` or new shared modules.

## Adding a new widget

1. **Create the three files:**
   - `{name}-widget-inline-css.ts` (import `MCP_WIDGET_CHROME_INLINE_CSS`; avoid hard `max-height`)
   - `{name}-widget-inline-script.ts` (follow the IIFE pattern above; include `notifySize()`)
   - `{name}-widget-html.ts` (assemble with `substituteWidgetPresentationToken`)

2. **Create the registration file:**
   - `register-{name}-ui-resources.ts` (register both MCP App and Skybridge)

3. **Add constants to `squadrules-ui-constants.ts`:**
   - `SQUADRULES_{NAME}_UI_URI` / `SQUADRULES_{NAME}_UI_SKYBRIDGE_URI`
   - `SQUADRULES_{NAME}_TOOL_UI_META`

4. **Wire into the tool:**
   - Add `_meta: SQUADRULES_{NAME}_TOOL_UI_META` to `registerTool` call
   - Call `register{Name}UiResources(server)` in `src/server.ts`

5. **Add to offerings:**
   - Add builder functions to `list-offerings-for-ui.ts`

6. **Test:**
   - Unit test the HTML builder output
   - Integration test `tools/list` includes `_meta` and resource is readable
   - Manual test in Cursor / Claude Desktop

## Sizing and layout

Widgets run inside host-managed iframes with a default height. To avoid
internal scrollbars:

- **Do not set `max-height` on `body` or the main content container.** Let
  content flow naturally; the host controls the outer scroll.
- **Send `ui/notifications/size-changed`** after every render so the host can
  resize the iframe to fit. Use `document.documentElement.scrollHeight` as the
  height value.
- **Call `notifySize()` in a `requestAnimationFrame`** to ensure the DOM has
  settled before measuring.

The activate widget uses this pattern. The forward widget's content is smaller
(one step at a time) so it rarely needs resizing, but the same pattern applies.

## Known constraints

### CSP restrictions in host webviews

`fetch()` calls from within the widget iframe may be blocked by the host's
Content Security Policy. Do not rely on network requests from widget JS for
instrumentation or data fetching. Use `postMessage` to communicate with the
host, or DOM-based debugging (visible breadcrumb elements) when diagnosing
issues.

### `structuredContent` delivery paths

The tool result may arrive in two shapes depending on the host:
1. `params.structuredContent` — structured object (preferred)
2. `params.content[0].text` — JSON string that must be parsed

Always handle both in `applyToolResult()`.

### `notifications/tool-result` (older hosts)

Some hosts send `notifications/tool-result` instead of
`ui/notifications/tool-result`. Widget message listeners must handle both
method names.
