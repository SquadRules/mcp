import type { Response } from 'express';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { collectSkillExportItemsForZip } from '../tools/export-skill-items.js';
import { setSkillZipDecodedBytes } from '../tools/export-telemetry.js';
import { flattenSkillItemsToZipPaths, pipeSkillZipToWritable } from '../tools/skill-export/zip-bundle.js';
import { DEFAULT_EXPORT_SKILL_ZIP_FILENAME } from '../config/export-zip-settings.js';

export async function streamSkillZipHttpResponse(
  res: Response,
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  adapterUris: string[]
): Promise<void> {
  const { items, primaryUri } = await collectSkillExportItemsForZip(memoryStore, qdrantService, adapterUris);
  const flat = flattenSkillItemsToZipPaths(items.map((it) => ({ slug: it.slug, files: it.files })));

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${DEFAULT_EXPORT_SKILL_ZIP_FILENAME}"`);
  res.setHeader('X-KAIROS-Primary-Export-Uri', primaryUri);
  res.setHeader('X-KAIROS-Export-Adapter-Count', String(items.length));
  res.setHeader('X-KAIROS-Export-Binary', '1');
  // Dual headers for SquadRules migration: both sets emitted so clients reading either name work.
  res.setHeader('X-SquadRules-Primary-Export-Uri', primaryUri);
  res.setHeader('X-SquadRules-Export-Adapter-Count', String(items.length));
  res.setHeader('X-SquadRules-Export-Binary', '1');

  let compressedBytes = 0;
  const pass = new PassThrough();
  pass.on('data', (chunk: Buffer) => {
    compressedBytes += chunk.length;
  });

  pass.pipe(res);
  await pipeSkillZipToWritable(pass, flat);
  await finished(res);
  setSkillZipDecodedBytes(compressedBytes);
}
