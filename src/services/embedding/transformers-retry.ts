/**
 * Retry only transient failures while downloading the pinned Transformers.js model.
 * Invalid revisions, missing files, authentication failures and local ONNX errors
 * must fail immediately rather than being disguised as network problems.
 */
const TRANSIENT_CODES = new Set([
  'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
  'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
]);

export function isTransientModelDownloadError(error: unknown): boolean {
  const visited = new Set<unknown>();
  function inspect(value: unknown): boolean {
    if (!value || visited.has(value)) return false;
    visited.add(value);
    if (typeof value !== 'object') return false;
    const e = value as {
      code?: unknown; status?: unknown; statusCode?: unknown;
      message?: unknown; cause?: unknown; errors?: unknown;
    };
    if (typeof e.code === 'string' && TRANSIENT_CODES.has(e.code)) return true;
    const status = typeof e.status === 'number' ? e.status : e.statusCode;
    if (typeof status === 'number' && (status === 408 || status === 429 || status >= 500 && status <= 599)) return true;
    const message = typeof e.message === 'string' ? e.message : '';
    if (/\b(?:ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|network timeout|network error|socket hang up)\b/i.test(message)) return true;
    if (/\b(?:HTTP|status|response)\s*(?:code\s*)?(408|429|5\d\d)\b/i.test(message)) return true;
    if (Array.isArray(e.errors) && e.errors.some(inspect)) return true;
    return inspect(e.cause);
  }
  return inspect(error);
}

export async function withModelDownloadRetries<T>(
  operation: () => Promise<T>,
  options: { offline: boolean; onRetry?: (attempt: number, error: unknown) => void; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const maxAttempts = options.offline ? 1 : 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts || !isTransientModelDownloadError(error)) throw error;
      options.onRetry?.(attempt, error);
      await (options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(1000 * 2 ** (attempt - 1));
    }
  }
  throw new Error('Unreachable retry state');
}
