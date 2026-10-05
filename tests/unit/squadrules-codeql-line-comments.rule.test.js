/**
 * @file ESLint rule tests for squadrules-codeql-comments/codeql-line-comment-integrity
 * Jest runs this project with the ts-jest default-esm preset, so the CommonJS-only modules
 * below are loaded through createRequire instead of top-level require().
 */
import { createRequire } from 'node:module';
import { describe, it } from '@jest/globals';

const require = createRequire(import.meta.url);
const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const { squadrulesCodeqlLineCommentsPlugin } = require('../../eslint/plugins/squadrules-codeql-line-comments.cjs');

const rule = squadrulesCodeqlLineCommentsPlugin.rules['codeql-line-comment-integrity'];

// RuleTester only registers Jest cases when it is given describe/it explicitly; under ESM they
// are not globals, and without them the suite would contain no tests at all.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

ruleTester.run('codeql-line-comment-integrity', rule, {
  valid: [
    {
      code: "// codeql[js/file-access-to-http]: outbound URL is derived from normalized config, not raw text.",
      filename: 'src/cli/example.ts',
    },
    {
      code: 'const x = 1;\n// codeql[js/user-controlled-bypass]: Method is restricted to GET and allowlisted verbs only.\nconst y = 2;',
      filename: 'src/http/middleware.ts',
    },
  ],
  invalid: [
    {
      code: '// codeql[js/foo]: short',
      filename: 'src/x.ts',
      errors: [
        {
          message: /at least 20 characters/,
        },
      ],
    },
    {
      code: '// codeql[js/bar]',
      filename: 'src/x.ts',
      errors: [
        {
          message: /at least 20 characters/,
        },
      ],
    },
    {
      code: '// codeql[js/log-injection]: false positive',
      filename: 'src/utils/structured-logger.ts',
      errors: [
        {
          message: /Do not use CodeQL line annotations for js\/log-injection/,
        },
      ],
    },
  ],
});
