/**
 * Record the environment a bake ran in, beside the steps it produced.
 *
 * `operator_supplied` is deliberately a list of `RECORD:` placeholders: the harness can
 * observe node, platform, hostname, package version, and the embedding/store selection,
 * but storage class, capacity, network policy, and production data volume are facts only
 * the operator holds. Writing a placeholder is honest; inventing a value is not.
 */
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

function packageVersion(entry) {
  try {
    const manifest = join(dirname(dirname(entry)), 'package.json');
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function captureEnvironment(opts) {
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    hostname: hostname(),
    package_version: packageVersion(opts.entry),
    entrypoint: opts.entry,
    embedding_provider: process.env['EMBEDDING_PROVIDER'] ?? 'fastembed',
    record_store: process.env['QDRANT_URL'] ? 'qdrant' : 'embedded LanceDB',
    fastembed_cache: process.env['FASTEMBED_CACHE_DIR'] ?? process.env['XDG_CACHE_HOME'] ?? 'default',
    operator_supplied: {
      storage_class: 'RECORD: disk type / filesystem / mount options',
      cpu_and_memory: 'RECORD: vCPU, RAM',
      network_policy: 'RECORD: egress/ingress relevant to the graph backend',
      data_volume: 'RECORD: production data size the bake was run against'
    }
  };
}
