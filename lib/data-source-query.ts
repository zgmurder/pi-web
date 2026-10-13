import mysql, { type RowDataPacket } from "mysql2";
import { getDataSource, connectionForTest, type DataSourceConnection } from "./data-sources";
import { validateQuery, validateQueryRange, validateReadOnlySql } from "./data-sources-shared";

export async function executeDataSourceQuery(id: string, queryName?: string, range?: { start: string; end: string }, signal?: AbortSignal) {
  return executeQuery(getDataSource(id), queryName, range, signal);
}
export async function testDataSourceConnection(input: unknown, signal?: AbortSignal) {
  await executeQuery(connectionForTest(input), undefined, undefined, signal);
}
export async function queryDataSourceSql(id: string, sql: string, range?: { start: string; end: string }, signal?: AbortSignal) {
  validateReadOnlySql(sql);
  if (range) validateQueryRange(range.start, range.end);
  if (/:(start|end)\b/.test(sql)) {
    if (!range) throw new Error("Provide start/end UTC timestamps for time parameters.");
    validateQuery(sql);
  }
  return executeQuery(getDataSource(id), undefined, range, signal, { sql });
}
export async function inspectDataSource(id: string, table?: string, offset = 0, signal?: AbortSignal) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error("Invalid schema offset.");
  if (table !== undefined && (!table || table.length > 64)) throw new Error("Invalid table name.");
  const source = getDataSource(id);
  const sql = table
    ? "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :database AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION"
    : "SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = :database ORDER BY TABLE_NAME";
  const result = await executeQuery(source, undefined, undefined, signal, { sql: `${sql} LIMIT 201 OFFSET ${offset}`, params: { database: source.database, table: table ?? "" } });
  return { ...result, nextOffset: result.truncated ? offset + result.rows.length : null };
}
async function executeQuery(source: DataSourceConnection, queryName?: string, range?: { start: string; end: string }, signal?: AbortSignal, custom?: { sql: string; params?: Record<string, string> }) {
  const template = queryName === undefined ? undefined : source.queries.find(q => q.name === queryName);
  if (queryName !== undefined && (!template || !range)) throw new Error("Unknown query template or missing time range.");
  if (template && range) { validateQuery(template.sql); validateQueryRange(range.start, range.end); }
  signal?.throwIfAborted();
  // A separate connection per bounded operation: cancellation never affects another session.
  const rawConnection = mysql.createConnection({ host: source.host, port: source.port, database: source.database,
    user: source.user, password: source.password, ssl: source.tls ? { rejectUnauthorized: true } : undefined,
    connectTimeout: 10000, multipleStatements: false, namedPlaceholders: true, dateStrings: true,
    supportBigNumbers: true, bigNumberStrings: true, flags: ["-LOCAL_FILES"] });
  const connection = rawConnection.promise();
  const destroy = () => connection.destroy();
  const timer = setTimeout(destroy, 15000);
  signal?.addEventListener("abort", destroy, { once: true });
  try {
    signal?.throwIfAborted();
    await connection.query("SET SESSION max_execution_time = 10000");
    await connection.query("SET SESSION time_zone = '+08:00'");
    await connection.query("START TRANSACTION READ ONLY");
    // Templates use Beijing wall-clock DATETIME values; TIMESTAMP uses the session zone above.
    const wallTime = (iso: string) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
    const select = template?.sql ?? custom?.sql;
    const sql = select ? `SELECT * FROM (${select}) AS pi_result LIMIT 201` : "SELECT 1 AS connected";
    const stream = rawConnection.query({ sql, timeout: 10000 }, custom?.params ?? (range ? { start: wallTime(range.start), end: wallTime(range.end) } : {})).stream({ highWaterMark: 1 });
    const result: RowDataPacket[] = [];
    let bytes = 0;
    let truncated = false;
    for await (const row of stream) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (result.length >= 200 || bytes + size > 64000) { truncated = true; break; }
      result.push(row); bytes += size;
    }
    return { source: source.name, query: queryName ?? (custom ? "read_only_query" : "connection_test"), range, timezone: "Asia/Shanghai", fetchedAt: new Date().toISOString(), rows: result, truncated };
  } catch {
    throw new Error(signal?.aborted ? "MySQL query cancelled." : "MySQL query failed or exceeded its limit. Check SELECT syntax, field names, permissions, network/TLS and MySQL 5.7+/8 compatibility.");
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", destroy); connection.destroy();
  }
}
