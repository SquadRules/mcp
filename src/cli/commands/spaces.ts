/**
 * spaces command — list available spaces and adapter counts.
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { renderSpacesPretty, renderSpacesText } from '../render.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';

export function spacesCommand(program: Command): void {
  program
    .command('spaces')
    .description('List available spaces and adapter counts')
    .option(
      '--include-adapter-titles',
      'Include per-space adapter titles and layer counts'
    )
    .action(async (options: { includeAdapterTitles?: boolean }) => {
      try {
        const backend = await createBackendFromProgram(program);
        const response = await backend.spaces({
          include_adapter_titles: Boolean(options.includeAdapterTitles)
        });
        emitResult(resolveOutputFormat(program), response, {
          pretty: renderSpacesPretty,
          text: renderSpacesText
        });
      } catch (error) {
        handleApiError(error, !isBrowserDisabled());
      }
    });
}
