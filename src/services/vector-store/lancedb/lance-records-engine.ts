/**
 * Lance table engine for memory records.
 *
 * Owns the connection and the one `memory_records` table, exposing the small set
 * of primitives the read/query/mutation layers are built on: open-or-create,
 * atomic upsert of Qdrant-shaped points, filtered scans, retrieve-by-id (with
 * vectors preserved for read-modify-write) and delete-by-filter. Reads before any
 * write treat the absent table as empty (never create it), so a cold start does
 * not touch disk for a read. Writes serialize on Lance MVCC via `withCommitRetry`.
 */
import type { LanceConnection, LanceTable } from '../lancedb-connection.js';
import { openLanceConnection } from '../lancedb-connection.js';
import { withCommitRetry } from '../commit-retry.js';
import { toRow, buildWhere, sqlLiteral, type LanceRecordRow, type QdrantPointLike } from './lance-records-schema.js';

const RECORDS_TABLE = 'memory_records';
/** Full scans use a generous limit; record counts per space are small. */
const SCAN_LIMIT = 100_000;

export class LanceRecordEngine {
  private connectionPromise: Promise<LanceConnection> | null = null;

  private getConnection(): Promise<LanceConnection> {
    if (!this.connectionPromise) {
      this.connectionPromise = openLanceConnection();
    }
    return this.connectionPromise;
  }

  /** Open the records table, or return null when nothing has been written yet. */
  async openTableIfPresent(): Promise<LanceTable | null> {
    const connection = await this.getConnection();
    const names = await connection.tableNames();
    if (!names.includes(RECORDS_TABLE)) return null;
    return connection.openTable(RECORDS_TABLE);
  }

  /** Open-or-create the records table, inferring the schema from a first row. */
  async ensureTableForWrite(firstRow: LanceRecordRow): Promise<LanceTable> {
    const connection = await this.getConnection();
    const names = await connection.tableNames();
    if (names.includes(RECORDS_TABLE)) {
      return connection.openTable(RECORDS_TABLE);
    }
    return connection.createTable(RECORDS_TABLE, [firstRow], { mode: 'create' });
  }

  /** Atomic upsert of Qdrant-shaped points (keyed by id) with commit retry. */
  async putPoints(points: QdrantPointLike[]): Promise<number> {
    if (points.length === 0) return 0;
    const rows = points.map(toRow);
    const table = await this.ensureTableForWrite(rows[0]!);
    await withCommitRetry(
      () =>
        table
          .mergeInsert('id')
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .execute(rows),
      `records-upsert:${rows.length}`
    );
    return rows.length;
  }

  /** Replace rows wholesale for a set of ids after building new points. */
  async putRows(rows: LanceRecordRow[]): Promise<void> {
    if (rows.length === 0) return;
    const table = await this.ensureTableForWrite(rows[0]!);
    await withCommitRetry(
      () =>
        table
          .mergeInsert('id')
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .execute(rows),
      `records-put:${rows.length}`
    );
  }

  /** Scan rows matching a Qdrant-style filter, optionally capped. */
  async scroll(
    filter: { must?: Array<Record<string, unknown>>; must_not?: Array<Record<string, unknown>> },
    limit?: number
  ): Promise<LanceRecordRow[]> {
    const table = await this.openTableIfPresent();
    if (!table) return [];
    const where = buildWhere(filter);
    const query = table.query();
    if (where) query.where(where);
    const rows = (await query.limit(limit ?? SCAN_LIMIT).toArray()) as unknown as LanceRecordRow[];
    return rows;
  }

  /** Retrieve a single raw row by id (carries vector columns for read-modify-write). */
  async retrieveRaw(id: string): Promise<LanceRecordRow | null> {
    const table = await this.openTableIfPresent();
    if (!table) return null;
    const rows = (await table
      .query()
      .where(`id = ${sqlLiteral(id)}`)
      .limit(1)
      .toArray()) as unknown as LanceRecordRow[];
    return rows[0] ?? null;
  }

  /** Delete rows matching a Qdrant-style filter. */
  async deleteByFilter(
    filter: { must?: Array<Record<string, unknown>>; must_not?: Array<Record<string, unknown>> }
  ): Promise<void> {
    const table = await this.openTableIfPresent();
    if (!table) return;
    const where = buildWhere(filter);
    if (!where) return;
    await withCommitRetry(() => table.delete(where), 'records-delete');
  }

  /** Delete one row by id. */
  async deleteById(id: string): Promise<void> {
    const table = await this.openTableIfPresent();
    if (!table) return;
    await withCommitRetry(() => table.delete(`id = ${sqlLiteral(id)}`), `records-delete:${id}`);
  }

  /** Rebuild and persist a row from a mutated Qdrant-shaped point. */
  async upsertPoint(point: QdrantPointLike): Promise<void> {
    await this.putPoints([point]);
  }
}
