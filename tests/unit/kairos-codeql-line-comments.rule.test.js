// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
/**
 * @file ESLint rule tests for kairos-codeql-comments/codeql-line-comment-integrity
 */
'use strict';

const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const { kairosCodeqlLineCommentsPlugin } = require('../../eslint/plugins/kairos-codeql-line-comments.cjs');

const rule = kairosCodeqlLineCommentsPlugin.rules['codeql-line-comment-integrity'];

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
