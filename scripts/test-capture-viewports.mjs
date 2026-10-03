#!/usr/bin/env node
// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Capture the UI at multiple viewport sizes. Agent tool for design review at real-world dimensions.
 *
 * Prereq: App running at baseUrl (default from .env: KAIROS_BASE_URL / KAIROS_API_URL / SERVER_PORT).
 * Usage: npm run design:viewports [baseUrl]
 * Output: .cursor/viewports/{mobile,tablet,desktop,wide}.png
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSquadrulesAppBaseUrl } from "./test-integration-app-base-url.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const outDir = join(repoRoot, ".cursor", "viewports");

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "wide", width: 1920, height: 1080 },
];

const baseUrl = process.argv[2] ?? `${resolveSquadrulesAppBaseUrl()}/ui/`;

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });

  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 15000 });
    const path = join(outDir, `${vp.name}.png`);
    await page.screenshot({ path });
    await page.close();
    console.log(`${vp.name} (${vp.width}×${vp.height}) → ${path}`);
  }

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
