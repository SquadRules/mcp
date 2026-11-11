/**
 * Critic-approved variant of the shared graph harness — kept apart on purpose.
 *
 * The critic gate is the thing a graph write is supposed to earn. A suite that hands
 * `tune` a verdict file it wrote itself proves the write, not the gate, so that
 * capability lives here instead of inside `graph-db-fixture.ts`, where every suite
 * would inherit it silently. `tests/scripts/ci-graph-lane.test.mjs` forbids the
 * required embedded lane from importing this module; suites that need it stay out
 * until the gate is exercised for real.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GraphFixture, type Runtime } from './graph-db-fixture.js';

/** The shared harness plus a critic verdict the suite writes itself. */
export class CriticApprovedGraphFixture extends GraphFixture {
  /** Real file whose first line is PASS — the critic verdict the tune gate reads. */
  verdictFile(): string {
    const path = join(this.tempDir('verdict'), 'verdict.txt');
    writeFileSync(path, 'PASS\n', 'utf8');
    return path;
  }

  /** Production `tune` of one adapter URI, carrying this fixture's synthetic PASS. */
  async tune(
    runtime: Runtime,
    spaceId: string,
    uri: string,
    content: string,
    options: { expectedVersion?: string } = {}
  ) {
    return this.onSpace(spaceId, () =>
      this.modules.tuneExecute.executeTune(
        runtime.qdrantService,
        {
          uris: [uri],
          content: [content],
          review_evidence: { verdict_file: this.verdictFile(), exit_code: 0, stdout: 'PASS' },
          ...(options.expectedVersion !== undefined && { expected_version: options.expectedVersion })
        },
        runtime.memoryStore
      )
    );
  }
}
