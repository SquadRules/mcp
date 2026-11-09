/**
 * Minimal ArangoDB HTTP client (no driver dependency).
 *
 * Only the endpoints this repository needs, verified against the ArangoDB HTTP
 * documentation:
 *   - `POST /_api/cursor`                      create an AQL cursor
 *   - `POST /_api/cursor/{id}`                 fetch the next batch
 *   - `POST /_api/transaction/begin`           open a stream transaction
 *   - `PUT  /_api/transaction/{id}`            commit
 *   - `DELETE /_api/transaction/{id}`          abort
 *   - `x-arango-trx-id`                        run a cursor inside a stream transaction
 *   - `GET /_api/version`                      server version / license
 *
 * Every request targets `/_db/<database>` so a shared server can host several
 * SquadRules databases without cross-reading.
 *
 * @see https://docs.arangodb.com/3.11/develop/http-api/queries/aql-queries/
 * @see https://docs.arangodb.com/3.11/develop/http-api/transactions/stream-transactions/
 */
import type { ArangoConnectionConfig } from '../../../config/graph-backend.js';

export interface ArangoErrorBody {
  error?: boolean;
  errorNum?: number;
  errorMessage?: string;
  code?: number;
}

/** A non-2xx ArangoDB response, preserved verbatim for actionable errors. */
export class ArangoHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorNum: number | undefined,
    public readonly body: ArangoErrorBody | null
  ) {
    super(message);
    this.name = 'ArangoHttpError';
  }
}

export interface ArangoVersionInfo {
  server: string;
  version: string;
  license?: string;
}

export interface StreamTransactionCollections {
  read?: string[];
  write?: string[];
  exclusive?: string[];
}

interface CursorResponse<T> {
  result?: T[];
  hasMore?: boolean;
  id?: string;
  error?: boolean;
  errorNum?: number;
  errorMessage?: string;
  code?: number;
}

const CURSOR_BATCH_SIZE = 1000;

export class ArangoHttpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | null;

  constructor(private readonly config: ArangoConnectionConfig) {
    this.baseUrl = `${config.url}/_db/${encodeURIComponent(config.database)}`;
    this.authHeader =
      config.username !== undefined
        ? `Basic ${Buffer.from(`${config.username}:${config.password ?? ''}`).toString('base64')}`
        : null;
  }

  /** Database-qualified request. `path` starts with `/_api/...`. */
  async request<T>(
    path: string,
    init: { method?: string; body?: unknown; transactionId?: string } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.authHeader) headers['authorization'] = this.authHeader;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.transactionId) headers['x-arango-trx-id'] = init.transactionId;

    const requestInit: RequestInit = {
      method: init.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs)
    };
    if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, requestInit);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ArangoHttpError(
        `ArangoDB request ${init.method ?? 'GET'} ${path} failed: ${reason}`,
        0,
        undefined,
        null
      );
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const body = (parsed ?? {}) as ArangoErrorBody;
      const detail = body.errorMessage ?? (text.length > 0 ? text.slice(0, 300) : response.statusText);
      throw new ArangoHttpError(
        `ArangoDB ${init.method ?? 'GET'} ${path} → ${response.status}: ${detail}`,
        response.status,
        body.errorNum,
        body
      );
    }
    return parsed as T;
  }

  /** Server version and license — used for the supported-series check. */
  async version(): Promise<ArangoVersionInfo> {
    return this.request<ArangoVersionInfo>('/_api/version');
  }

  /** Run one AQL statement to completion and return every result row. */
  async query<T>(aql: string, bindVars: Record<string, unknown> = {}): Promise<T[]> {
    return this.drainCursor<T>(await this.createCursor<T>(aql, bindVars));
  }

  /** Run one AQL statement inside an open stream transaction. */
  async queryInTransaction<T>(
    transactionId: string,
    aql: string,
    bindVars: Record<string, unknown> = {}
  ): Promise<T[]> {
    const created = await this.createCursor<T>(aql, bindVars, transactionId);
    return this.drainCursor<T>(created, transactionId);
  }

  private async createCursor<T>(
    aql: string,
    bindVars: Record<string, unknown>,
    transactionId?: string
  ): Promise<CursorResponse<T>> {
    const response = await this.request<CursorResponse<T>>('/_api/cursor', {
      method: 'POST',
      body: { query: aql, bindVars, batchSize: CURSOR_BATCH_SIZE },
      ...(transactionId ? { transactionId } : {})
    });
    return response;
  }

  private async drainCursor<T>(
    first: CursorResponse<T>,
    transactionId?: string
  ): Promise<T[]> {
    const rows: T[] = [...(first.result ?? [])];
    let cursorId = first.id;
    let hasMore = first.hasMore === true;
    while (hasMore && cursorId) {
      const next = await this.request<CursorResponse<T>>(`/_api/cursor/${encodeURIComponent(cursorId)}`, {
        method: 'POST',
        ...(transactionId ? { transactionId } : {})
      });
      rows.push(...(next.result ?? []));
      hasMore = next.hasMore === true;
      cursorId = next.id ?? cursorId;
    }
    return rows;
  }

  /** Open a stream transaction valid for the listed collections. */
  async beginTransaction(collections: StreamTransactionCollections): Promise<string> {
    const response = await this.request<{ result?: { id?: string } }>('/_api/transaction/begin', {
      method: 'POST',
      body: { collections }
    });
    const id = response.result?.id;
    if (!id) {
      throw new ArangoHttpError('ArangoDB returned no stream transaction id', 0, undefined, null);
    }
    return id;
  }

  async commitTransaction(id: string): Promise<void> {
    await this.request(`/_api/transaction/${encodeURIComponent(id)}`, { method: 'PUT' });
  }

  async abortTransaction(id: string): Promise<void> {
    await this.request(`/_api/transaction/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /**
   * Run `fn` inside one stream transaction: commit on success, abort on any error
   * so a failed multi-statement write leaves no partial state behind.
   */
  async withTransaction<T>(
    collections: StreamTransactionCollections,
    fn: (transactionId: string) => Promise<T>
  ): Promise<T> {
    const id = await this.beginTransaction(collections);
    try {
      const result = await fn(id);
      await this.commitTransaction(id);
      return result;
    } catch (err) {
      try {
        await this.abortTransaction(id);
      } catch {
        // The original failure is the actionable one.
      }
      throw err;
    }
  }
}
