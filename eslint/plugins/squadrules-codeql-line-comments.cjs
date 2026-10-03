'use strict';

/** Minimum characters in the justification after `]:` (trimmed). */
const DEFAULT_MIN_JUSTIFICATION = 20;

/** Paths (POSIX, suffix match) where log-injection must be handled via sanitization, not CodeQL line annotations. */
const NO_LOG_INJECTION_SUPPRESSION_SUFFIXES = ['src/utils/structured-logger.ts'];

/**
 * @param {string} absPath
 * @returns {string}
 */
function toPosixPath(absPath) {
  return absPath.replace(/\\/g, '/');
}

const squadrulesCodeqlLineCommentsPlugin = {
  rules: {
    'codeql-line-comment-integrity': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require substantive `// codeql[js/...]:` justifications and forbid log-injection suppressions in structured-logger (use sanitizeLogMessage / sanitizeBindingsForAudit).',
        },
        schema: [
          {
            type: 'object',
            properties: {
              minJustificationLength: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const minLen =
          context.options[0] && typeof context.options[0].minJustificationLength === 'number'
            ? context.options[0].minJustificationLength
            : DEFAULT_MIN_JUSTIFICATION;
        const sourceCode = context.sourceCode;
        const posixFile = toPosixPath(context.filename || '');
        const forbidLogInjectionHere = NO_LOG_INJECTION_SUPPRESSION_SUFFIXES.some(suffix =>
          posixFile.endsWith(suffix),
        );

        return {
          Program() {
            for (const comment of sourceCode.getAllComments()) {
              if (comment.type !== 'Line') continue;
              const raw = comment.value;
              const idx = raw.indexOf('codeql[');
              if (idx === -1) continue;
              const fromCodeql = raw.slice(idx);
              const idMatch = fromCodeql.match(/^codeql\[([^\]\r\n]+)\]/);
              if (!idMatch) continue;

              const queryId = idMatch[1].trim();
              const afterBracket = fromCodeql.slice(idMatch[0].length);
              const justificationMatch = afterBracket.match(/^\s*:\s*(.*)$/);
              const justification = justificationMatch ? justificationMatch[1].trim() : '';

              const absStart = comment.range[0] + 2 + idx;
              const absEnd = absStart + idMatch[0].length;
              const locBracket = {
                start: sourceCode.getLocFromIndex(absStart),
                end: sourceCode.getLocFromIndex(absEnd),
              };

              if (forbidLogInjectionHere && /^js\/log-injection$/i.test(queryId)) {
                context.report({
                  loc: locBracket,
                  message:
                    'Do not use CodeQL line annotations for js/log-injection in structured-logger: pass messages and bindings through sanitizeLogMessage and sanitizeBindingsForAudit before the sink (same pattern as info(object, string)).',
                });
                continue;
              }

              if (!justificationMatch || justification.length < minLen) {
                context.report({
                  loc: locBracket,
                  message: `CodeQL line comment must include ": " and at least ${minLen} characters of justification after the rule id (merge-safe rationale). Found ${justification.length} character(s).`,
                });
              }
            }
          },
        };
      },
    },
  },
};

module.exports = { squadrulesCodeqlLineCommentsPlugin };
