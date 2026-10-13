import { platformRequest, platformSources, selectedPlatform } from "./model-platform";
import { validateQuery, validateQueryRange, validateReadOnlySql } from "./data-sources-shared";

export async function getPlatformSource(id: string, signal?: AbortSignal) {
  const { config } = selectedPlatform(id);
  const source = (await platformSources(config, signal)).find(s => s.id === id);
  if (!source) throw new Error("Platform source no longer exists or is unavailable.");
  return source;
}
export async function queryPlatform(id: string, args: { action?: string; sql?: string; table?: string; offset?: number; query?: string; start?: string; end?: string }, signal?: AbortSignal) {
  const { config, sourceId } = selectedPlatform(id);
  const source = await getPlatformSource(id, signal);
  const base = { source: source.name, timezone: "Asia/Shanghai", fetchedAt: new Date().toISOString() };
  if (args.query) throw new Error("Platform sources use schema and sql actions, not local templates.");
  if (args.action === "schema") {
    const offset = args.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || args.table !== undefined && (!args.table || args.table.length > 64)) throw new Error("Invalid schema request.");
    const response = await platformRequest(config, `/datasources/${sourceId}/tables${args.table ? `/${encodeURIComponent(args.table)}/columns` : ""}`, undefined, signal) as { tables?: unknown[]; columns?: unknown[] };
    const all = args.table ? response.columns : response.tables;
    if (!Array.isArray(all)) throw new Error("Invalid platform schema response.");
    const rows: unknown[] = []; let bytes = 0;
    for (const row of all.slice(offset, offset + 201)) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (rows.length >= 200 || bytes + size > 60000) break;
      rows.push(row); bytes += size;
    }
    if (!rows.length && offset < all.length) throw new Error("Platform schema row exceeds the result limit.");
    const truncated = offset + rows.length < all.length;
    return { ...base, rows, truncated, nextOffset: truncated ? offset + rows.length : null };
  }
  if (args.action === "sql") {
    let sql = args.sql ?? ""; validateReadOnlySql(sql);
    if (args.start || args.end) validateQueryRange(args.start ?? "", args.end ?? "");
    if (/:(start|end)\b/.test(sql)) {
      validateQuery(sql); validateQueryRange(args.start ?? "", args.end ?? "");
      const wallTime = (s: string) => new Date(Date.parse(s) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
      // Only strictly validated ISO timestamps become literals; no arbitrary interpolation.
      sql = sql.replace(/:(start|end)\b/g, (_, key: "start" | "end") => `'${wallTime(args[key]!)}'`);
    }
    const response = await platformRequest(config, `/datasources/${sourceId}/query`, { sql }, signal) as Record<string, unknown>;
    if (!Array.isArray(response.columns) || !Array.isArray(response.rows) || response.rows.length > 200
      || typeof response.truncated !== "boolean" || Buffer.byteLength(JSON.stringify(response)) > 64000) throw new Error("Invalid or oversized platform query response.");
    return { ...base, columns: response.columns, rows: response.rows, truncated: response.truncated, fetchedAt: response.fetchedAt, range: args.start ? { start: args.start, end: args.end } : undefined };
  }
  return { ...base, notes: source.notes, now: new Date().toISOString(), capabilities: { schema: true, readOnlySql: true, templatesRequired: false }, queries: [], nextStep: "Use action=schema to inspect tables and column comments, then action=sql with a single SELECT. Templates are not required. Confirm ambiguous business rules." };
}
