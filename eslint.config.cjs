// eslint.config.cjs — thin entry; full flat config lives under eslint/
// Forbidden tokens + protocol wording review: eslint/plugins/squadrules-forbidden-text.cjs
// CodeQL `// codeql[js/…]:` line integrity: eslint/plugins/squadrules-codeql-line-comments.cjs
// MCP Apps widgets (handshake + HTML shell): eslint/plugins/squadrules-mcp-widget.cjs
// Scope: src/, scripts/, tests/ code + **/*.md + context7.json; squadrules-forbidden-text off for .agents/skills/**/*.md and CONTRIBUTING.md (see eslint/flat-config.cjs)
// Inline eslint-disable / file comments cannot change rules (linterOptions.noInlineConfig).

'use strict';

const path = require('node:path');
const { includeIgnoreFile } = require('@eslint/compat');
const { createFlatConfig } = require('./eslint/flat-config.cjs');

module.exports = [
  includeIgnoreFile(path.resolve(__dirname, '.gitignore')),
  ...createFlatConfig(path.resolve(__dirname)),
];
