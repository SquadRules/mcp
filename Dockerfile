# Release image: install published package from npm (no source build).
# Used by CI/release; version passed as build-arg. For local dev build-from-source, use Dockerfile.dev.
# Multi-arch: build for linux/amd64,linux/arm64 (set by buildx).
#
# Node policy: this production/runtime image tracks Node LTS (see FROM below). Non-LTS Node Current
# is exercised in GitHub Actions only (setup-node in workflows), not a second published image unless
# product explicitly asks for one.
#
# Targets:
#   runtime (default) — npm registry install (Release / publish-container).
#   runtime-ci — same layers after install, but package from .ci/docker/package.tgz (Integration workflow).
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS base

VOLUME /snapshots

# Refresh all installed Alpine packages (pinned FROM digest can still trail repo security fixes).
RUN apk update && apk upgrade --no-cache

# Pin global npm to a newer release than the default in the base image (bundled deps drift with the CLI).
# npm 11.18.0 bundles tar 7.5.19 (CVE-2026-59873/CVE-2026-59874 / CVE-2026-73566) and still ships:
#   - brace-expansion 5.0.7  → patched to 5.0.12 (CVE-2026-14257, CVE-2026-69152, CVE-2026-102276, CVE-2026-102278)
#   - ip-address 10.2.0      → patched to 10.3.1 (CVE-2026-69192)
#   - undici 6.27.0          → patched to 6.28.1 (CVE-2026-19534)
# until an npm release bundles the fixes.
RUN npm install -g npm@11.18.0 && \
    npm pack tar@7.5.21 --silent && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/tar && \
    mkdir -p /usr/local/lib/node_modules/npm/node_modules/tar && \
    tar -xzf tar-7.5.21.tgz -C /usr/local/lib/node_modules/npm/node_modules/tar --strip-components=1 && \
    rm tar-7.5.21.tgz && \
    cd /tmp && \
    npm pack brace-expansion@5.0.12 --silent && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/brace-expansion && \
    mkdir -p /usr/local/lib/node_modules/npm/node_modules/brace-expansion && \
    tar -xzf brace-expansion-5.0.12.tgz -C /usr/local/lib/node_modules/npm/node_modules/brace-expansion --strip-components=1 && \
    rm brace-expansion-5.0.12.tgz && \
    npm pack ip-address@10.3.1 --silent && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/ip-address && \
    mkdir -p /usr/local/lib/node_modules/npm/node_modules/ip-address && \
    tar -xzf ip-address-10.3.1.tgz -C /usr/local/lib/node_modules/npm/node_modules/ip-address --strip-components=1 && \
    rm ip-address-10.3.1.tgz && \
    npm pack undici@6.28.1 --silent && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/undici && \
    mkdir -p /usr/local/lib/node_modules/npm/node_modules/undici && \
    tar -xzf undici-6.28.1.tgz -C /usr/local/lib/node_modules/npm/node_modules/undici --strip-components=1 && \
    rm undici-6.28.1.tgz && cd /

ARG PACKAGE_VERSION
RUN test -n "$PACKAGE_VERSION" || (echo "Build-arg PACKAGE_VERSION is required" && exit 1)

RUN addgroup -g 1001 -S nodejs && \
    adduser -S kairos -u 1001

WORKDIR /app

FROM base AS deps-registry
ARG PACKAGE_VERSION
RUN printf '%s\n' "{\"private\":true,\"dependencies\":{\"@jakub-plichcinski/kairos-mcp\":\"${PACKAGE_VERSION}\"},\"overrides\":{\"minimatch\":\"^10.2.3\",\"tar\":\"^7.5.19\",\"typescript\":\"5.9.3\",\"brace-expansion\":\"^5.0.12\",\"undici\":\"8.10.2\"}}" > package.json && \
    npm install --omit=dev && \
    npm cache clean --force && \
    chown -R kairos:nodejs /app

FROM base AS deps-local
COPY .ci/docker/package.tgz /tmp/pkg.tgz
RUN printf '%s\n' "{\"private\":true,\"dependencies\":{\"@jakub-plichcinski/kairos-mcp\":\"file:/tmp/pkg.tgz\"},\"overrides\":{\"minimatch\":\"^10.2.3\",\"tar\":\"^7.5.19\",\"typescript\":\"5.9.3\",\"brace-expansion\":\"^5.0.12\",\"undici\":\"8.10.2\"}}" > package.json && \
    npm install --omit=dev && \
    npm cache clean --force && \
    chown -R kairos:nodejs /app

# Keep runtime-ci and runtime final layers in sync (duplicate on purpose; Docker has no shared snippet).
FROM deps-local AS runtime-ci
RUN mkdir -p logs storage/qdrant /snapshots && \
    chown -R kairos:nodejs /app logs storage /snapshots
USER kairos
ARG SERVER_PORT=3000
ENV SERVER_PORT=${SERVER_PORT}
ARG METRICS_PORT=9090
ENV METRICS_PORT=${METRICS_PORT}
EXPOSE ${SERVER_PORT} ${METRICS_PORT}
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + process.env.SERVER_PORT + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1
ENV NODE_ENV=production
ENV QDRANT_URL=http://qdrant:6333
ENV QDRANT_COLLECTION=kairos_memories
CMD ["node", "node_modules/@jakub-plichcinski/kairos-mcp/dist/index.js"]

FROM deps-registry AS runtime
RUN mkdir -p logs storage/qdrant /snapshots && \
    chown -R kairos:nodejs /app logs storage /snapshots
USER kairos
ARG SERVER_PORT=3000
ENV SERVER_PORT=${SERVER_PORT}
ARG METRICS_PORT=9090
ENV METRICS_PORT=${METRICS_PORT}
EXPOSE ${SERVER_PORT} ${METRICS_PORT}
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + process.env.SERVER_PORT + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1
ENV NODE_ENV=production
ENV QDRANT_URL=http://qdrant:6333
ENV QDRANT_COLLECTION=kairos_memories
CMD ["node", "node_modules/@jakub-plichcinski/kairos-mcp/dist/index.js"]
