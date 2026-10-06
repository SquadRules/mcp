'use strict';

const {
  NO_TEST_MOCKS_RULE,
  NO_JEST_MOCK_OUTSIDE_UNIT_RULE,
  NO_AUTH_ENABLED_OVERRIDE_RULE,
} = require('./rules/shared-snippets.cjs');
const { markdownPlainTextParser } = require('./parsers/markdown-plain-text.cjs');
const { squadrulesForbiddenTextPlugin } = require('./plugins/squadrules-forbidden-text.cjs');
const { squadrulesCodeqlLineCommentsPlugin } = require('./plugins/squadrules-codeql-line-comments.cjs');
const { squadrulesMcpWidgetPlugin } = require('./plugins/squadrules-mcp-widget.cjs');

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

/**
 * @param {string} rootDir Absolute path to repository root (for tsconfigRootDir)
 * @returns {import('eslint').Linter.FlatConfig[]}
 */
function createFlatConfig(rootDir) {
  return [
    // -------------------------------------------------------------------------
    // 0. Global ignores
    // -------------------------------------------------------------------------
    {
      ignores: [
        'node_modules/**',
        '.venv/**',
        '**/.venv/**',
        'dist/**',
        '**/dist/**',
        'build/**',
        'coverage/**',
        'cache/**',
        '.cache/**',
        'helm/**',
        '.ai/**',
        '.squadrules/**',
        '.squadrules-work/**',
        '.local/**',
        'non-public/marketing-positioning.md',
        '.git',
        '.git/**',
        '**/.git/**',
        '.turbo/**',
        '.next/**',
        'eslint.config.cjs',
        '.markdownlint.jsonc', // Markdown lint config (not JS)
        // Markdown is linted for forbidden strings (see 3d). Non-code: JSON/YAML/… + context7.json negation below.
        '**/*.json',
        '!context7.json',
        '**/*.yaml',
        '**/*.yml',
        '**/*.tgz',
        '.trivyignore',
        '**/*.png',
        '**/*.jpg',
        '**/*.jpeg',
        '**/*.gif',
        '**/*.webp',
        '**/*.ico',
        '**/*.svg',
        '**/.DS_Store',
        '**/.env*',
        '**/.gitignore',
        '**/.cursorignore',
        '**/.npmignore',
        '**/.npmrc',
        '**/.dockerignore',
        '**/Dockerfile*',
        '**/.kilocode/**',
        '**/.obsidian/**',
        '**/.vscode/**',
        '**/*.log',
        '**/tools.txt',
        '**/compose/**',
        '**/reports/**',
        '**/*.tf',
        '**/*.tfvars*',
        '**/*.hcl',
        '**/.terraform/**',
        '**/argocd/**',
        '**/.kilocodeignore',
        '**/*.disabled',
        '**/*.py',
        // Fixture trees: mixed extensions; exclude whole dir from **/*.* max-lines + parsers.
        'tests/test-data/**',
        '**/__pycache__/**',
        '**/*.pyc',
        '**/.cursorrules',
        '**/.cursor/**',
        '**/requirements.txt',
        '**/snapshots/**',
        '**/*.snapshot',
        '**/*.html',
        '**/*.css',
        '**/*.tsbuildinfo',
        '**/*.woff2',
        '**/*.pack',
        '**/*.idx',
        '**/*.rev',
        '**/*.svg',
        'logo/**',
        'logos/**',
        '.qoder/**',
        'wiki/**',
        '**/*.md' // Markdown files are linted by markdownlint-cli2
      ],
    },

    // -------------------------------------------------------------------------
    // 0b. No inline overrides (eslint-disable / eslint-env / file-level rule tweaks in comments)
    // Exception: src/eslint-inline-allowed/** — duplicate backend blocks below with noInlineConfig: false.
    // -------------------------------------------------------------------------
    {
      files: ['**/*.*'],
      ignores: ['src/eslint-inline-allowed/**'],
      linterOptions: {
        noInlineConfig: true,
      },
    },

    // -------------------------------------------------------------------------
    // 1. Global max-lines
    // -------------------------------------------------------------------------
    {
      files: ['**/*.*'],
      rules: {
        'max-lines': [
          'error',
          {
            max: 350,
            skipBlankLines: false,
            skipComments: false,
          },
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 2a. Frontend (src/ui)
    // -------------------------------------------------------------------------
    {
      files: ['src/ui/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          tsconfigRootDir: rootDir,
          project: ['./tsconfig.ui.json'],
        },
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
      },
      rules: {
        'max-lines': [
          'error',
          { max: 350, skipBlankLines: false, skipComments: false },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
        'no-console': 'off',
      },
    },

    {
      files: ['eslint/flat-config.cjs'],
      rules: { 'max-lines': 'off' },
    },

    // -------------------------------------------------------------------------
    // 2b. Backend source + tests (excludes src/ui)
    // -------------------------------------------------------------------------
    {
      files: [
        'src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
        'tests/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
      ],
      ignores: ['src/ui/**', 'src/eslint-inline-allowed/**'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          tsconfigRootDir: rootDir,
          project: ['./tsconfig.json', './tsconfig.tests.json'],
        },
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
        'squadrules-codeql-comments': squadrulesCodeqlLineCommentsPlugin,
      },
      rules: {
        'max-lines': [
          'error',
          {
            max: 350,
            skipBlankLines: false,
            skipComments: false,
          },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
        'squadrules-codeql-comments/codeql-line-comment-integrity': 'error',
        ...NO_AUTH_ENABLED_OVERRIDE_RULE,
      },
    },

    // -------------------------------------------------------------------------
    // 2b-inline. Same as 2b; inline eslint comments allowed (upstream API names, etc.).
    // -------------------------------------------------------------------------
    {
      files: ['src/eslint-inline-allowed/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          tsconfigRootDir: rootDir,
          project: ['./tsconfig.json', './tsconfig.tests.json'],
        },
      },
      linterOptions: {
        noInlineConfig: false,
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
        'squadrules-codeql-comments': squadrulesCodeqlLineCommentsPlugin,
      },
      rules: {
        'max-lines': [
          'error',
          {
            max: 350,
            skipBlankLines: false,
            skipComments: false,
          },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
        'squadrules-codeql-comments/codeql-line-comment-integrity': 'error',
        ...NO_AUTH_ENABLED_OVERRIDE_RULE,
      },
    },

    // -------------------------------------------------------------------------
    // 3. Backend: no console, no test mocks
    // -------------------------------------------------------------------------
    {
      files: ['src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
      ignores: ['src/ui/**', 'src/eslint-inline-allowed/**'],
      rules: {
        'no-console': 'error',
        ...NO_TEST_MOCKS_RULE,
      },
    },

    {
      files: ['src/eslint-inline-allowed/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
      linterOptions: {
        noInlineConfig: false,
      },
      rules: {
        'no-console': 'error',
        ...NO_TEST_MOCKS_RULE,
      },
    },

    // -------------------------------------------------------------------------
    // 3c. Forbidden SQUADRULES strings (src + scripts + tests JS/TS; Markdown → 3d)
    // -------------------------------------------------------------------------
    {
      files: [
        'src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
        'scripts/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
        'tests/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
      ],
      ignores: ['src/ui/**', 'src/eslint-inline-allowed/**'],
      plugins: {
        'squadrules-forbidden-text': squadrulesForbiddenTextPlugin,
      },
      rules: {
        'squadrules-forbidden-text/no-forbidden-squadrules-text': 'error',
      },
    },
    {
      files: ['src/eslint-inline-allowed/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
      linterOptions: {
        noInlineConfig: false,
      },
      plugins: {
        'squadrules-forbidden-text': squadrulesForbiddenTextPlugin,
      },
      rules: {
        'squadrules-forbidden-text/no-forbidden-squadrules-text': 'error',
      },
    },
    // -------------------------------------------------------------------------
    // 3cb. MCP Apps HTML widgets (src/mcp-apps): handshake + safe inline script + HTML shell
    // -------------------------------------------------------------------------
    {
      files: ['src/mcp-apps/*-widget-inline-script.ts', 'src/mcp-apps/spaces-mcp-app-widget-html.ts'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          tsconfigRootDir: rootDir,
          project: ['./tsconfig.json', './tsconfig.tests.json'],
        },
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
        'squadrules-mcp-widget': squadrulesMcpWidgetPlugin,
      },
      rules: {
        'squadrules-mcp-widget/handshake-and-safety': 'error',
        'max-lines': [
          'error',
          { max: 520, skipBlankLines: false, skipComments: false },
        ],
      },
    },
    {
      files: ['src/mcp-apps/*-widget-html.ts'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          tsconfigRootDir: rootDir,
          project: ['./tsconfig.json', './tsconfig.tests.json'],
        },
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
        'squadrules-mcp-widget': squadrulesMcpWidgetPlugin,
      },
      rules: {
        'squadrules-mcp-widget/html-shell': 'error',
      },
    },

    // -------------------------------------------------------------------------
    // 3d. All **/*.md (forbidden strings; stub parser; max-lines off)
    // -------------------------------------------------------------------------
    {
      files: ['**/*.md'],
      languageOptions: {
        parser: markdownPlainTextParser,
        parserOptions: {
          project: null,
        },
      },
      plugins: {
        'squadrules-forbidden-text': squadrulesForbiddenTextPlugin,
      },
      rules: {
        'max-lines': 'off',
        'squadrules-forbidden-text/no-forbidden-squadrules-text': 'error',
        'squadrules-forbidden-text/review-protocol-wording': 'warn',
      },
    },
    {
      files: ['src/embed-docs/mem/*.md'],
      rules: {
        'squadrules-forbidden-text/review-protocol-wording': 'off',
      },
    },
    {
      files: ['.github/workflows/README.md'],
      rules: {
        'squadrules-forbidden-text/review-protocol-wording': 'off',
      },
    },
    {
      // Maintainer agent skills + root contributing guide: may quote triggers, URIs, and vocabulary by design.
      files: ['.agents/skills/**/*.md', 'CONTRIBUTING.md'],
      rules: {
        'squadrules-forbidden-text/no-forbidden-squadrules-text': 'off',
        'squadrules-forbidden-text/review-protocol-wording': 'off',
      },
    },

    // -------------------------------------------------------------------------
    // 3da. All shell scripts (stub parser; no code rules)
    // -------------------------------------------------------------------------
    {
      files: ['**/*.sh'],
      languageOptions: {
        parser: markdownPlainTextParser,
        parserOptions: {
          project: null,
        },
      },
      rules: {
        'max-lines': 'off',
      },
    },

    // -------------------------------------------------------------------------
    // 3db. Shell scripts in scripts/ (forbidden strings; stub parser)
    // -------------------------------------------------------------------------
    {
      files: ['scripts/**/*.sh'],
      languageOptions: {
        parser: markdownPlainTextParser,
        parserOptions: {
          project: null,
        },
      },
      plugins: {
        'squadrules-forbidden-text': squadrulesForbiddenTextPlugin,
      },
      rules: {
        'max-lines': 'off',
        'squadrules-forbidden-text/no-forbidden-squadrules-text': 'error',
      },
    },

    // -------------------------------------------------------------------------
    // 3e. Root context7.json (stub parser = full-text scan for forbidden strings)
    // -------------------------------------------------------------------------
    {
      files: ['context7.json'],
      languageOptions: {
        parser: markdownPlainTextParser,
        parserOptions: {
          project: null,
        },
      },
      plugins: {
        'squadrules-forbidden-text': squadrulesForbiddenTextPlugin,
      },
      rules: {
        'max-lines': 'off',
        'squadrules-forbidden-text/no-forbidden-squadrules-text': 'error',
      },
    },

    // -------------------------------------------------------------------------
    // 4. Tests — unit may use jest.mock/vi.mock; other test trees may not
    // -------------------------------------------------------------------------
    {
      files: ['tests/unit/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: [
        'tests/integration/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
        'tests/utils/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
        'tests/load/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
      ],
      rules: {
        'no-console': 'off',
        ...NO_TEST_MOCKS_RULE,
      },
    },
    {
      files: ['tests/ui/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
      rules: {
        'no-console': 'off',
        ...NO_JEST_MOCK_OUTSIDE_UNIT_RULE,
      },
    },

    // -------------------------------------------------------------------------
    // 5. Root configs & scripts (no TS project)
    // -------------------------------------------------------------------------
    {
      files: ['eslint.config.cjs'],
      languageOptions: {
        sourceType: 'script',
        ecmaVersion: 2022,
        parserOptions: {
          project: null,
        },
      },
      rules: NO_AUTH_ENABLED_OVERRIDE_RULE,
    },
    {
      files: ['jest.config.js'],
      languageOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
        parserOptions: {
          project: null,
        },
      },
      rules: NO_AUTH_ENABLED_OVERRIDE_RULE,
    },
    {
      files: ['knip.config.ts'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          project: null,
          sourceType: 'module',
        },
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
      },
      rules: NO_AUTH_ENABLED_OVERRIDE_RULE,
    },
    {
      files: ['scripts/**/*.{ts,cts,mts}'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          project: null,
          sourceType: 'module',
        },
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
        ...NO_AUTH_ENABLED_OVERRIDE_RULE,
      },
    },
    {
      files: ['scripts/**/*.{js,cjs,mjs}'],
      languageOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
        parserOptions: {
          project: null,
        },
      },
      rules: {
        ...NO_AUTH_ENABLED_OVERRIDE_RULE,
      },
    },
  ];
}

module.exports = { createFlatConfig };
