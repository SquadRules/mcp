'use strict';

/**
 * MCP Apps inline HTML widgets under src/mcp-apps/ (Cursor / SEP-1865 hosts).
 *
 * - handshake-and-safety: embedded scripts must keep ui/initialize + tool-result wiring;
 *   disallow eval / new Function / document.write.
 * - html-shell: *-widget-html.ts bundles must include a minimal safe document shell.
 */

const RE_INLINE_SCRIPT_OR_SPACES_APP =
  /\/mcp-apps\/(?:[^/]+-widget-inline-script\.ts|spaces-mcp-app-widget-html\.ts)$/;

const RE_WIDGET_HTML = /\/mcp-apps\/[^/]+-widget-html\.ts$/;

const REQUIRED_HANDSHAKE_SUBSTRINGS = [
  'ui/initialize',
  'ui/notifications/initialized',
  'postMessage',
  'tool-result',
  'addEventListener',
];

const UNSAFE_PATTERNS = [
  { re: /\beval\s*\(/, label: 'eval(' },
  { re: /\bnew\s+Function\s*\(/, label: 'new Function(' },
  { re: /\bdocument\.write\s*\(/, label: 'document.write(' },
];

/** Full HTML5 document (legacy / tool-rendered pages). */
const REQUIRED_HTML_FULL_DOCUMENT = ['<!DOCTYPE html>', 'lang="en"', 'viewport'];

/**
 * MCP Apps HTML resource fragment (same shape as Confluence widgets: mount root + assets).
 * Host wraps this in a document; omit DOCTYPE/head/body here.
 */
const MCP_APP_FRAGMENT_ROOT_RE = /<div\s+id="(?:squadrules|kairos)-[a-z0-9-]+-root"/i;

const REQUIRED_HTML_FRAGMENT = ['<style', '<script'];

/** @type {import('eslint').ESLint.Plugin} */
const kairosMcpWidgetPlugin = {
  meta: { name: 'kairos-mcp-widget', version: '1.0.0' },
  rules: {
    'handshake-and-safety': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'MCP App widget scripts must preserve host handshake and avoid unsafe DOM/JS APIs.',
        },
        schema: [],
        messages: {
          missing: 'MCP widget must include "{{sub}}" for host compatibility (ui/initialize lifecycle, tool results, or parent messaging).',
          unsafe: 'MCP widget must not use {{pattern}} (security / host stability).',
        },
      },
      create(context) {
        const filename = (typeof context.filename === 'string' ? context.filename : context.getFilename?.() ?? '')
          .replace(/\\/g, '/');
        if (!RE_INLINE_SCRIPT_OR_SPACES_APP.test(filename)) {
          return {};
        }
        return {
          Program() {
            const text = context.sourceCode.getText();
            for (const sub of REQUIRED_HANDSHAKE_SUBSTRINGS) {
              if (!text.includes(sub)) {
                context.report({
                  loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
                  messageId: 'missing',
                  data: { sub },
                });
              }
            }
            for (const { re, label } of UNSAFE_PATTERNS) {
              if (re.test(text)) {
                context.report({
                  loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
                  messageId: 'unsafe',
                  data: { pattern: label },
                });
              }
            }
          },
        };
      },
    },

    'html-shell': {
      meta: {
        type: 'problem',
        docs: {
          description: 'MCP App widget HTML builders must emit a minimal standards-compliant shell.',
        },
        schema: [],
        messages: {
          missing:
            'MCP widget HTML must include "{{sub}}" (full document: type/lang/viewport, or fragment: root div + style + script).',
        },
      },
      create(context) {
        const filename = (typeof context.filename === 'string' ? context.filename : context.getFilename?.() ?? '')
          .replace(/\\/g, '/');
        if (!RE_WIDGET_HTML.test(filename)) {
          return {};
        }
        return {
          Program() {
            const text = context.sourceCode.getText();
            const isFragment = MCP_APP_FRAGMENT_ROOT_RE.test(text);
            const required = isFragment ? REQUIRED_HTML_FRAGMENT : REQUIRED_HTML_FULL_DOCUMENT;
            for (const sub of required) {
              if (!text.includes(sub)) {
                context.report({
                  loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
                  messageId: 'missing',
                  data: { sub },
                });
              }
            }
          },
        };
      },
    },
  },
};

module.exports = { kairosMcpWidgetPlugin };
