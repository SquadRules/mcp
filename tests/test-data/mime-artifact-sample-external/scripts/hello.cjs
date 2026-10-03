#!/usr/bin/env node
// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Hello world using conf/routes.yaml (MIME: text/javascript).
 * Parses `greeting:` without a YAML dependency.
 * Uses .cjs so `node hello.cjs` works under repo package `"type": "module"`.
 */
const fs = require('node:fs');
const path = require('node:path');

const sampleRoot =
    process.env.KAIROS_MIME_SAMPLE_ROOT || path.join(path.dirname(__filename), '..');
const yamlPath = path.join(sampleRoot, 'conf', 'routes.yaml');
const text = fs.readFileSync(yamlPath, 'utf8');
const m = text.match(/greeting:\s*"([^"]*)"/);
const msg = m ? m[1] : '';
process.stdout.write((msg || 'missing greeting') + '\n');
process.exit(msg ? 0 : 1);