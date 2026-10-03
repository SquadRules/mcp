// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { KAIROS_MCP_WIDGET_PRESENTATION_ONLY } from '../config.js';

/** Token replaced in inline widget scripts when HTML is assembled (see widget HTML builders). */
export const KAIROS_WIDGET_PRESENTATION_ONLY_TOKEN = '__KAIROS_WIDGET_PRESENTATION_ONLY__';

/** Inject `true`/`false` for {@link KAIROS_WIDGET_PRESENTATION_ONLY_TOKEN} from server config. */
export function substituteWidgetPresentationToken(source: string): string {
  return source.replaceAll(
    KAIROS_WIDGET_PRESENTATION_ONLY_TOKEN,
    KAIROS_MCP_WIDGET_PRESENTATION_ONLY ? 'true' : 'false'
  );
}
