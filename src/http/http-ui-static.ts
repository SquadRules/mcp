import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { HTTP_RATE_LIMIT_MAX, HTTP_RATE_LIMIT_WINDOW_MS } from "../config.js";
import { structuredLogger } from "../utils/structured-logger.js";
import { createRateLimiter } from "./http-server-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentDirName = path.basename(path.resolve(__dirname, ".."));

/** Default: dist/ui next to compiled `dist/http`, or two levels up from `src/http` when running from TypeScript sources. */
function defaultUiDir(): string {
  return parentDirName === "src"
    ? path.resolve(__dirname, "..", "..", "dist", "ui")
    : path.resolve(__dirname, "..", "ui");
}

/**
 * Root directory of the Vite build (`vite build` → `dist/ui`).
 * Set `SQUADRULES_UI_DIR` to an absolute path (or path relative to `process.cwd()`) when the server
 * resolves the wrong tree (e.g. global install, symlinked package, or mismatched worktree).
 */
function resolveSquadrulesUiDir(): string {
  const override = process.env["SQUADRULES_UI_DIR"]?.trim();
  if (!override) return defaultUiDir();
  return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
}

/** True if the built Squadrules page chunk includes browse-by-letter (post–letter-blocks UI). */
function builtUiHasLetterBrowse(uiDir: string): boolean {
  const assetsDir = path.join(uiDir, "assets");
  try {
    if (!fs.existsSync(assetsDir)) return false;
    for (const name of fs.readdirSync(assetsDir)) {
      if (!name.startsWith("SquadrulesPage-") || !name.endsWith(".js")) continue;
      const text = fs.readFileSync(path.join(assetsDir, name), "utf8");
      return text.includes("browseByLetterHint") || text.includes("BROWSE_LETTERS");
    }
  } catch {
    return false;
  }
  return false;
}

const isProductionUiCache = process.env["NODE_ENV"] === "production";

/**
 * Serve the built SPA at URL /ui.
 * - GET / -> redirect to /ui
 * - Static files from dist/ui at /ui
 * - SPA fallback: GET /ui/* that don't match a file -> index.html
 */
export function setupUiStatic(app: express.Express): void {
  const UI_DIR = resolveSquadrulesUiDir();
  const indexPath = path.join(UI_DIR, "index.html");
  const hasIndex = fs.existsSync(indexPath);
  const letterBrowse = builtUiHasLetterBrowse(UI_DIR);
  structuredLogger.info(
    `HTTP static UI: dir=${UI_DIR} index_html=${hasIndex} browse_by_letter_bundle=${letterBrowse}` +
      (process.env["SQUADRULES_UI_DIR"]?.trim() ? " (SQUADRULES_UI_DIR override)" : "")
  );
  if (hasIndex && !letterBrowse) {
    structuredLogger.warn(
      "Built UI under this path does not contain browse-by-letter code; run npm run ui:build in the same tree or set SQUADRULES_UI_DIR to that repo's dist/ui."
    );
  }

  const uiLimiter = createRateLimiter({
    identifier: "ui-static",
    windowMs: HTTP_RATE_LIMIT_WINDOW_MS,
    limit: HTTP_RATE_LIMIT_MAX,
    message: "Too many UI requests. Try again later."
  });

  app.get("/", uiLimiter, (_req, res) => {
    res.redirect(302, "/ui");
  });

  app.use(
    "/ui",
    uiLimiter,
    express.static(UI_DIR, {
      etag: isProductionUiCache,
      lastModified: isProductionUiCache,
      maxAge: isProductionUiCache ? "1y" : 0,
      setHeaders(res) {
        if (!isProductionUiCache) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        }
      },
    })
  );

  app.use("/ui", uiLimiter, (req, res) => {
    if (!isProductionUiCache) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    }
    res.sendFile("index.html", { root: UI_DIR });
  });
}
