'use strict';

/**
 * Disallow specific env keys and removed MCP tool names anywhere in source
 * (case-insensitive: identifiers, strings, comments, etc.). Bearer token must
 * come from the shared config file ($XDG_CONFIG_HOME/squadrules/config.json), not
 * SQUADRULES_BEARER_TOKEN in source.
 */
// Banned wording: drop obsolete code/shims; rephrase comments (older format, transitional, compat)—never strip useful docs just to silence a hit.
const SQUADRULES_FORBIDDEN_LEGACY_REFERENCE_NAMES = [
  'SQUADRULES_BEARER_TOKEN',
  'SQUADRULES_WORK_DIR',
  'squadrules_work_dir',
  'local_artifact_dir',
  'squadrules_begin',
  'squadrules_attest',
  'squadrules_delete',
  'squadrules_dump',
  'squadrules_mint',
  'squadrules_next',
  'squadrules_search',
  'squadrules_spaces',
  'legacy',
];

/**
 * Multi-word phrases (case-insensitive). Tokens are split on spaces here; in source,
 * one or more `[\W_]` (non-word chars or `_`) may appear between each pair — so multiple
 * spaces, newlines, `-`, `.`, `/`, and `natural_language` all match, but CamelCase like
 * `completionRule` does not. Outer `\b` only. Longer phrases sort first.
 */
const SQUADRULES_FORBIDDEN_CASE_INSENSITIVE_PHRASES = [
  'natural language triggers',
  'natural language trigger',
  'backwards compatibility',
  'backward compatibility',
  'natural language',
  'completion rule',
];

/** Exact markers (case-sensitive). */
const SQUADRULES_FORBIDDEN_CASE_SENSITIVE_MARKERS = ['SQUADRULES:BODY-START', 'SQUADRULES:BODY-END'];

/**
 * Only phrases where `protocol` is clearly not “SQUADRULES stored artifact” prose.
 * Do not add broad patterns (e.g. `protocol execution`, `protocol chains`) — those
 * hide hits that should warn unless the file uses <!-- squadrules-lint-allow-protocol-synonyms -->.
 * Match must fully cover the reported `protocol` token (case-insensitive).
 */
const SQUADRULES_PROTOCOL_WORDING_ALLOWLIST_SOURCES = [
  String.raw`\bmodel\s+context\s+protocol\b`,
  String.raw`\bsquadrules(?:\s+mcp)?\s+protocol\b`,
  // AGENTS.md canonical phrases only (do not use bare `protocol execution` — too broad).
  String.raw`\bprotocol\s+execution\s+model\b`,
  String.raw`\bprotocol\s+authority\b`,
  String.raw`\*\*protocol\*\*`,
  String.raw`\/protocol\/openid-connect`,
  String.raw`\bprotocol\.ts\b`,
];

/**
 * @param {string} win
 * @param {number} relStart
 * @param {number} relEnd
 * @returns {boolean}
 */
function squadrulesProtocolWordingAllowedInWindow(win, relStart, relEnd) {
  for (const src of SQUADRULES_PROTOCOL_WORDING_ALLOWLIST_SOURCES) {
    const re = new RegExp(src, 'gi');
    let m;
    while ((m = re.exec(win)) !== null) {
      const ms = m.index;
      const me = ms + m[0].length;
      if (relStart >= ms && relEnd <= me) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} canonical
 * @param {string} matched
 * @returns {string}
 */
function squadrulesForbiddenLegacyReferenceMessage(canonical, matched) {
  if (canonical === 'SQUADRULES_BEARER_TOKEN') {
    return `Disallowed legacy env key "${matched}" (same as ${canonical}, case-insensitive). Use the config file for tokens; authenticate (e.g. squadrules login or OAuth PKCE) instead of embedding this in source.`;
  }
  if (canonical === 'SQUADRULES_WORK_DIR') {
    return `Disallowed retired local-artifact env key "${matched}" (same as ${canonical}, case-insensitive). Use SQUADRULES_LOCAL_ARTIFACT_DIR only.`;
  }
  if (canonical === 'squadrules_work_dir') {
    return `Disallowed retired JSON field name "${matched}" (same as ${canonical}, case-insensitive). Use squadrules_local_artifact_dir only (lowercase snake of SQUADRULES_LOCAL_ARTIFACT_DIR).`;
  }
  if (canonical === 'local_artifact_dir') {
    return `Disallowed retired short JSON key for the local artifact path (matched "${matched}", case-insensitive). Use squadrules_local_artifact_dir only (lowercase snake of SQUADRULES_LOCAL_ARTIFACT_DIR).`;
  }
  if (canonical === 'legacy') {
    return `Disallowed prior-era wording (matched "${matched}", case-insensitive substring). AI: remove obsolete code paths, compatibility shims, and dual implementations—leave a single supported path. Reword identifiers and prose accordingly (e.g. older format, transitional, compat); do not delete useful documentation only to pass lint. Third-party APIs whose identifiers contain this substring: build the key or value at runtime (e.g. string concat) so the forbidden substring does not appear contiguously in source.`;
  }
  return `Disallowed legacy MCP tool name "${matched}" (same as ${canonical}, case-insensitive). Use the current MCP/HTTP tool names and API.`;
}

/**
 * @param {string} matched
 * @returns {string}
 */
function squadrulesForbiddenCaseSensitiveMarkerMessage(matched) {
  return `Disallowed marker "${matched}" must not appear in source (case-sensitive exact match).`;
}

/**
 * @param {string} matched
 * @param {string} canonicalPhrase
 * @returns {string}
 */
function squadrulesForbiddenPhraseMessage(matched, canonicalPhrase) {
  return `Disallowed phrasing (matched "${matched}", same as "${canonicalPhrase}", case-insensitive; only non-word separators between words, /\\bWORD1[\\W_]+WORD2\\b/i — multiple spaces, newlines, _.-/ etc.). AI: remove obsolete branches, compatibility shims, and dual code paths—one supported behavior only. Reword comments and strings to match; do not delete useful documentation only to pass lint.`;
}

/**
 * @param {string} matched
 * @returns {string}
 */
function squadrulesForbiddenStandaloneV10Message(matched) {
  return `Disallowed standalone version tag (matched "${matched}", case-insensitive). Use neutral wording (current protocol surface, adapter API). \`v10-*\` prefixes (e.g. module paths, test labels) are allowed; bare "v10" is not.`;
}

/**
 * @returns {string}
 */
function squadrulesForbiddenDeprecatedLayerRowUriSchemeMessage() {
  return (
    'Disallowed ambiguous URI scheme for stored layer rows: use squadrules://layer/{uuid} (and optional ?execution_id=). ' +
    'Do not emit the older overloaded surface; build transitional parsing with string concat if ingest must accept it. ' +
    'Distinguish adapter id (squadrules://adapter/…) from layer row (squadrules://layer/…).'
  );
}

// Retired prior brand word, concatenated so this file never contains it contiguously.
const PRIOR_BRAND_WORD = ['ka', 'iros'].join('');

// // # <!-- --> or /* */ syntax) lifts ONLY the PRIOR_BRAND_WORD ban for the whole file.
function hasSquadrulesCompatSurfaceMarker(text) {
  const head = text.split('\n').slice(0, 60).join('\n');
  const re = /(?:\/\/|#|<!--|\/\*)\s*squadrules-compat-surface\s*:([^\n]*)/gi;
  for (let m = re.exec(head); m !== null; m = re.exec(head)) {
    if (m[1].replace(/\s*(?:\*\/|-->)\s*$/, '').trim()) return true;
  }
  return false;
}

/** Full-source scan; keep this module outside matched lint globs or it would self-match list entries. */
const squadrulesForbiddenTextPlugin = {
  rules: {
    'no-forbidden-squadrules-text': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow SQUADRULES_BEARER_TOKEN, squadrules_* MCP names, prior-era wording "legacy" (case-insensitive substring), the retired prior brand word (case-insensitive substring; whole-file opt-out via a top-of-file squadrules-compat-surface marker with a non-empty reason), standalone "v10" (not v10-*), multi-word phrases (case-insensitive; /\\bWORD1[\\W_]+WORD2\\b/i — separators only, e.g. multiple spaces or underscores, not letters), and SQUADRULES:BODY-* markers (case-sensitive). Applied to src/, scripts/, tests/ (code), all **/*.md, and root context7.json. Fix by removing obsolete code/shims and rewording—do not strip useful comments only to pass lint.',
        },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;
        const text = sourceCode.getText();
        const seenAt = new Set();
        const compatSurfaceFile = hasSquadrulesCompatSurfaceMarker(text);
        for (const canonical of SQUADRULES_FORBIDDEN_LEGACY_REFERENCE_NAMES) {
          if (canonical === 'legacy') {
            continue;
          }
          const re = new RegExp(
            `(?<![\\w])${escapeRegExp(canonical)}(?![\\w])`,
            'gi',
          );
          let m;
          while ((m = re.exec(text)) !== null) {
            const at = m.index;
            if (seenAt.has(at)) continue;
            seenAt.add(at);
            const start = sourceCode.getLocFromIndex(at);
            const end = sourceCode.getLocFromIndex(at + m[0].length);
            context.report({
              loc: { start, end },
              message: squadrulesForbiddenLegacyReferenceMessage(canonical, m[0]),
            });
          }
        }
        {
          const canonical = 'legacy';
          const re = /legacy/gi;
          let m;
          while ((m = re.exec(text)) !== null) {
            const at = m.index;
            if (seenAt.has(at)) continue;
            seenAt.add(at);
            const start = sourceCode.getLocFromIndex(at);
            const end = sourceCode.getLocFromIndex(at + m[0].length);
            context.report({
              loc: { start, end },
              message: squadrulesForbiddenLegacyReferenceMessage(canonical, m[0]),
            });
          }
        }
        {
          // Allow v10-* (paths, slugs); forbid bare v10 / V10 (punctuation or whitespace after).
          const re = /(?<![A-Za-z0-9_])v10(?!-)(?![A-Za-z0-9_])/gi;
          let m;
          while ((m = re.exec(text)) !== null) {
            const at = m.index;
            if (seenAt.has(at)) continue;
            seenAt.add(at);
            const start = sourceCode.getLocFromIndex(at);
            const end = sourceCode.getLocFromIndex(at + m[0].length);
            context.report({
              loc: { start, end },
              message: squadrulesForbiddenStandaloneV10Message(m[0]),
            });
          }
        }
        {
          const deprecatedLayerRowUriPrefix = ['squadrules', '://', 'me', 'm'].join('');
          const re = new RegExp(escapeRegExp(deprecatedLayerRowUriPrefix), 'gi');
          let m;
          while ((m = re.exec(text)) !== null) {
            const at = m.index;
            if (seenAt.has(at)) continue;
            seenAt.add(at);
            const start = sourceCode.getLocFromIndex(at);
            const end = sourceCode.getLocFromIndex(at + m[0].length);
            context.report({
              loc: { start, end },
              message: squadrulesForbiddenDeprecatedLayerRowUriSchemeMessage(),
            });
          }
        }
        if (!compatSurfaceFile) {
          const re = new RegExp(escapeRegExp(PRIOR_BRAND_WORD), 'gi');
          for (let m = re.exec(text); m !== null; m = re.exec(text)) {
            if (seenAt.has(m.index)) continue;
            seenAt.add(m.index);
            context.report({
              loc: { start: sourceCode.getLocFromIndex(m.index), end: sourceCode.getLocFromIndex(m.index + m[0].length) },
            });
          }
        }
        const forbiddenPhrasesSorted = [...SQUADRULES_FORBIDDEN_CASE_INSENSITIVE_PHRASES].sort(
          (a, b) => b.trim().length - a.trim().length,
        );
        for (const phrase of forbiddenPhrasesSorted) {
          const words = phrase.trim().split(/\s+/).filter(Boolean);
          if (words.length < 2) {
            continue;
          }
          // [\W_]+ between tokens: multiple spaces, newlines, _.-/ etc.; not letters (avoids completionRule).
          const pattern = `\\b${words.map((w) => escapeRegExp(w)).join('[\\W_]+')}\\b`;
          const re = new RegExp(pattern, 'gi');
          let m;
          while ((m = re.exec(text)) !== null) {
            const at = m.index;
            if (seenAt.has(at)) continue;
            seenAt.add(at);
            const start = sourceCode.getLocFromIndex(at);
            const end = sourceCode.getLocFromIndex(at + m[0].length);
            context.report({
              loc: { start, end },
              message: squadrulesForbiddenPhraseMessage(m[0], phrase),
            });
          }
        }
        for (const marker of SQUADRULES_FORBIDDEN_CASE_SENSITIVE_MARKERS) {
          const re = new RegExp(
            `(?<![\\w])${escapeRegExp(marker)}(?![\\w])`,
            'g',
          );
          let m;
          while ((m = re.exec(text)) !== null) {
            const at = m.index;
            if (seenAt.has(at)) continue;
            seenAt.add(at);
            const start = sourceCode.getLocFromIndex(at);
            const end = sourceCode.getLocFromIndex(at + m[0].length);
            context.report({
              loc: { start, end },
              message: squadrulesForbiddenCaseSensitiveMarkerMessage(m[0]),
            });
          }
        }
        return {};
      },
    },
    'review-protocol-wording': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Warn on bare "protocol" in markdown: prefer "adapter" or "workflow" for stored SQUADRULES artifacts. Tight allowlist in SQUADRULES_PROTOCOL_WORDING_ALLOWLIST_SOURCES (MCP product name, SQUADRULES Protocol, etc.); for intentional synonym-heavy copy add <!-- squadrules-lint-allow-protocol-synonyms --> in the first ~2.5k chars.',
        },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;
        const text = sourceCode.getText();
        // Whole-file opt-out (no inline eslint-disable in this repo): place early in the file (e.g. right after YAML frontmatter). Use ~2.5k because some skills have long frontmatter before the marker.
        if (/<!--\s*squadrules-lint-allow-protocol-synonyms\s*-->/i.test(text.slice(0, 2500))) {
          return {};
        }
        // Hyphenated slugs (e.g. review-protocol-wording) must not match; prose uses spaces/punctuation around "protocol".
        const re = /(?<![-A-Za-z0-9_])protocol(?![-A-Za-z0-9_])/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
          const pStart = m.index;
          const pEnd = pStart + m[0].length;
          const winStart = Math.max(0, pStart - 160);
          const winEnd = Math.min(text.length, pEnd + 160);
          const win = text.slice(winStart, winEnd);
          const relStart = pStart - winStart;
          const relEnd = pEnd - winStart;
          if (squadrulesProtocolWordingAllowedInWindow(win, relStart, relEnd)) {
            continue;
          }
          const start = sourceCode.getLocFromIndex(pStart);
          const end = sourceCode.getLocFromIndex(pEnd);
          context.report({
            loc: { start, end },
            message:
              'Ambiguous "protocol" wording: prefer "adapter" or "workflow" for stored SQUADRULES artifacts unless this is Model Context Protocol, "SQUADRULES Protocol", or another tight allowlist phrase in eslint/plugins/squadrules-forbidden-text.cjs. Whole-file synonymy: <!-- squadrules-lint-allow-protocol-synonyms --> near the top (no inline eslint-disable in this repo).',
          });
        }
        return {};
      },
    },
  },
};

module.exports = { squadrulesForbiddenTextPlugin };
