import { SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY } from '../config.js';

/** Token replaced in inline widget scripts when HTML is assembled (see widget HTML builders). */
export const SQUADRULES_WIDGET_PRESENTATION_ONLY_TOKEN = '__SQUADRULES_WIDGET_PRESENTATION_ONLY__';

/** Inject `true`/`false` for {@link SQUADRULES_WIDGET_PRESENTATION_ONLY_TOKEN} from server config. */
export function substituteWidgetPresentationToken(source: string): string {
  return source.replaceAll(
    SQUADRULES_WIDGET_PRESENTATION_ONLY_TOKEN,
    SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY ? 'true' : 'false'
  );
}
