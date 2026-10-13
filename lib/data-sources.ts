import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readRegularFileText } from "./regular-file";
import { serializeByKey } from "./key-serializer";
import { validateQuery, type DataSourcePublic } from "./data-sources-shared";

export type DataSourceConnection = Omit<DataSourcePublic, "hasPassword"> & { password: string };
type Source = DataSourceConnection;
const filePath = () => join(getAgentDir(), "pi-web-data-sources.json");
function readSources(): Source[] {
  const text = readRegularFileText(filePath(), 1024 * 1024);
  if (text === undefined) return [];
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value) || value.length > 100) throw new Error();
    return value.map(s => parseSource(s, s));
  } catch { throw new Error("Data source configuration is invalid; file was not changed."); }
}
function publicSource({ password, ...source }: Source): DataSourcePublic { return { ...source, hasPassword: !!password }; }
export function listDataSources(): DataSourcePublic[] { return readSources().map(publicSource); }
export function getDataSource(id: string): Source {
  const source = readSources().find(s => s.id === id);
  if (!source) throw new Error("Data source no longer exists. Select another source.");
  return source;
}
export function connectionForTest(value: unknown): Source {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid data source.");
  const input = value as Record<string, unknown>;
  const previous = typeof input.id === "string" && input.id ? getDataSource(input.id) : undefined;
  // Testing a connection must not depend on unfinished business rules or query templates.
  return parseSource({ ...input, name: "Connection test", notes: "", queries: [] }, previous);
}
function parseSource(value: unknown, previous?: Source): Source {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid data source.");
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number, required = true) => {
    const x = v[key];
    if (typeof x !== "string" || x.length > max || (required && !x.trim()) || /[\u0000-\u001f]/.test(x) && key !== "notes") throw new Error(`Invalid ${key}.`);
    return x;
  };
  const id = v.id === undefined || v.id === "" ? randomUUID() : text("id", 64);
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid data source id.");
  if (!Number.isInteger(v.port) || Number(v.port) < 1 || Number(v.port) > 65535 || typeof v.tls !== "boolean") throw new Error("Invalid port or TLS option.");
  if (!Array.isArray(v.queries) || v.queries.length > 20) throw new Error("At most 20 query templates are allowed.");
  const names = new Set<string>();
  const queries = v.queries.map(q => {
    if (!q || typeof q.name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(q.name) || names.has(q.name)
      || typeof q.description !== "string" || q.description.length > 1000 || typeof q.sql !== "string") throw new Error("Invalid or duplicate query template.");
    names.add(q.name); validateQuery(q.sql);
    return { name: q.name, description: q.description, sql: q.sql };
  });
  return { id, name: text("name", 80), host: text("host", 255), port: Number(v.port), database: text("database", 128), user: text("user", 128),
    password: v.password === undefined ? previous?.password ?? "" : text("password", 4096, false), tls: v.tls, notes: text("notes", 12000, false), queries };
}
export async function changeDataSource(action: "save" | "delete", value: unknown): Promise<DataSourcePublic[]> {
  const path = filePath();
  return serializeByKey(Symbol.for("pi-web:data-sources"), path, async () => {
    mkdirSync(getAgentDir(), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(path, { realpath: false, retries: 3 });
    try {
      const sources = readSources();
      if (action === "delete") {
        if (typeof value !== "string" || !sources.some(s => s.id === value)) throw new Error("Data source not found.");
        sources.splice(sources.findIndex(s => s.id === value), 1);
      } else {
        const id = (value as { id?: unknown } | null)?.id;
        const index = sources.findIndex(s => s.id === id);
        if (id && index < 0) throw new Error("Data source no longer exists; reload before saving.");
        const source = parseSource(value, sources[index]);
        if (index >= 0) sources[index] = source; else sources.push(source);
        if (sources.length > 100) throw new Error("At most 100 data sources are allowed.");
      }
      const json = JSON.stringify(sources, null, 2);
      if (Buffer.byteLength(json) > 1024 * 1024) throw new Error("Data source configuration is too large.");
      writePrivateFileAtomicSync(path, json + "\n");
      return sources.map(publicSource);
    } finally { await release(); }
  });
}
