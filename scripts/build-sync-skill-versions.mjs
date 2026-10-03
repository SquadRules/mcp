#!/usr/bin/env node
/**
 * Sync or check versions with one target: the package.json version (the in-repo
 * synced baseline). semantic-release bumps package.json in the release job
 * workspace and re-runs this script there; git tags are NOT a target because
 * they advance past the in-repo baseline after every semantic-release run.
 * - src/embed-docs/mem/*.md frontmatter = package.json version.
 * - .agents/skills/** (SKILL.md metadata.version + references/SQUADRULES.md frontmatter)
 *   = package.json version.
 * - Default: update files to the target.
 * - --check: compare; exit 1 if any version differs from the target.
 *
 * Usage: node scripts/build-sync-skill-versions.mjs [--check]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(REPO_ROOT, '.agents', 'skills');
const MEM_DIR = path.join(REPO_ROOT, 'src', 'embed-docs', 'mem');

const CHECK = process.argv.includes('--check');

/** Get package.json version from repo root. */
async function getPackageVersion() {
  const p = path.join(REPO_ROOT, 'package.json');
  const text = await fs.readFile(p, 'utf8');
  const j = JSON.parse(text);
  if (typeof j.version !== 'string') throw new Error('package.json missing version');
  return j.version;
}

/** Extract version from SKILL.md metadata line: "  version: \"1.0.0\"" */
function getSkillVersionFromContent(content) {
  const m = content.match(/^\s{2}version:\s*["']?([^"'\s]+)["']?\s*$/m);
  return m ? m[1] : null;
}

/** Replace metadata.version line in SKILL.md */
function replaceSkillVersionLine(content, newVersion) {
  return content.replace(/^(\s{2}version:\s*)["']?[^"'\n]*["']?\s*$/m, `$1"${newVersion}"`);
}

/** Extract version from frontmatter at the start of content only (line "version: 1.0.0" or version: "1.0.0"). Ignores --- mid-document (horizontal rules). */
function getSquadrulesVersionFromContent(content) {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return null;
  const afterFirst = trimmed.slice(3);
  const second = afterFirst.indexOf('\n---');
  if (second === -1) return null;
  const block = afterFirst.slice(0, second);
  const m = block.match(/^version:\s*["']?([^"'\s\n]+)["']?\s*$/m);
  return m ? m[1] : null;
}

/** Replace version line in frontmatter at the start of content only. Ignores --- mid-document. */
function replaceSquadrulesVersionLine(content, newVersion) {
  const trimmed = content.trimStart();
  const leadingWhitespace = content.slice(0, content.length - trimmed.length);
  if (!trimmed.startsWith('---')) return content;
  const afterFirst = trimmed.slice(3);
  const second = afterFirst.indexOf('\n---');
  if (second === -1) return content;
  const block = afterFirst.slice(0, second);
  const rest = afterFirst.slice(second);
  // Do not append \n here: the match ends before the line break, so adding \n would duplicate it (blank line after version:).
  const newBlock = block.replace(/^(version:\s*)["']?[^"'\n]*["']?\s*$/m, `$1"${newVersion}"`);
  return leadingWhitespace + trimmed.slice(0, 3) + newBlock + rest;
}

async function main() {
  const target = await getPackageVersion();
  const skillDirs = await fs.readdir(SKILLS_DIR, { withFileTypes: true }).then((entries) =>
    entries.filter((e) => e.isDirectory()).map((e) => e.name)
  );

  const mismatches = [];
  const updated = [];

  for (const dir of skillDirs) {
    const skillMdPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
    const squadrulesPath = path.join(SKILLS_DIR, dir, 'references', 'SQUADRULES.md');

    // SKILL.md metadata.version -> package.json version
    try {
      const skillContent = await fs.readFile(skillMdPath, 'utf8');
      const current = getSkillVersionFromContent(skillContent);
      if (current !== null) {
        if (CHECK) {
          if (current !== target) mismatches.push(`${dir}/SKILL.md: ${current} (expected ${target}, skills=package.json)`);
        } else {
          const newContent = replaceSkillVersionLine(skillContent, target);
          if (newContent !== skillContent) {
            await fs.writeFile(skillMdPath, newContent, 'utf8');
            updated.push(`${dir}/SKILL.md`);
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // references/SQUADRULES.md frontmatter version -> package.json version
    try {
      const squadrulesContent = await fs.readFile(squadrulesPath, 'utf8');
      const current = getSquadrulesVersionFromContent(squadrulesContent);
      if (current !== null) {
        if (CHECK) {
          if (current !== target) mismatches.push(`${dir}/references/SQUADRULES.md: ${current} (expected ${target}, skills=package.json)`);
        } else {
          const newContent = replaceSquadrulesVersionLine(squadrulesContent, target);
          if (newContent !== squadrulesContent) {
            await fs.writeFile(squadrulesPath, newContent, 'utf8');
            updated.push(`${dir}/references/SQUADRULES.md`);
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  // src/embed-docs/mem/*.md frontmatter version -> package.json version
  try {
    const memFiles = await fs.readdir(MEM_DIR).then((names) => names.filter((n) => n.endsWith('.md')));
    for (const name of memFiles) {
      const memPath = path.join(MEM_DIR, name);
      const content = await fs.readFile(memPath, 'utf8');
      const current = getSquadrulesVersionFromContent(content);
      if (current !== null) {
        if (CHECK) {
          if (current !== target) mismatches.push(`src/embed-docs/mem/${name}: ${current} (expected ${target}, mem=package.json)`);
        } else {
          const newContent = replaceSquadrulesVersionLine(content, target);
          if (newContent !== content) {
            await fs.writeFile(memPath, newContent, 'utf8');
            updated.push(`src/embed-docs/mem/${name}`);
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (CHECK) {
    if (mismatches.length > 0) {
      console.error('Version(s) do not match target (package.json):');
      for (const m of mismatches) console.error('  -', m);
      process.exit(1);
    }
    return;
  }

  if (updated.length > 0) {
    console.log('Updated mem + skills ->', target + ':', updated.join(', '));
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
