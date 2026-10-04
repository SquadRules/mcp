import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Generic artifact-download helper: stream an HTTP response body to disk.
//
// The registry target list (Docker Hub + quay) and remote-manifest inspection that used to
// live here moved to SquadRules/containers, which now owns image build/scan/sign/publish.
// The npm release pipeline only needs to download recovery artifacts, so that is all that
// remains.
export async function download(response, file) {
  if (!response.ok) throw new Error(`Artifact download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}
