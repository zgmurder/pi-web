export interface DataSourceQuery { name: string; description: string; sql: string }
export interface DataSourcePublic {
  id: string; name: string; host: string; port: number; database: string; user: string;
  tls: boolean; notes: string; queries: DataSourceQuery[]; hasPassword: boolean;
}
export const DATA_SOURCE_ENTRY = "pi-web:data-source";
export function selectedDataSource(entries: readonly { type: string; customType?: string; data?: unknown }[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === DATA_SOURCE_ENTRY) {
      const id = (entry.data as { id?: unknown } | undefined)?.id;
      return typeof id === "string" ? id : null;
    }
  }
  return null;
}

export function validateReadOnlySql(sql: string): void {
  // Defense in depth only: SELECT-only database grants are the security boundary.
  if (sql.length > 12000 || !/^SELECT\s/i.test(sql.trim()) || /;|--|#|\/\*|\*\//.test(sql)
    || /\b(into|outfile|dumpfile|for|lock|sleep|benchmark|load_file|get_lock|release_lock|procedure)\b/i.test(sql)
    || /@|:=/.test(sql)) throw new Error("Only a single non-locking SELECT is supported (no comments or side-effect functions).");
}
export function validateQuery(sql: string): void {
  validateReadOnlySql(sql);
  const parameters: string[] = sql.match(/:[a-zA-Z_][a-zA-Z_0-9]*/g) ?? [];
  if (!parameters.includes(":start") || !parameters.includes(":end") || parameters.some(p => p !== ":start" && p !== ":end")) {
    throw new Error("Each query must use :start and :end, with no other named parameters.");
  }
}
export function validateQueryRange(start: string, end: string): void {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s) && Number.isFinite(Date.parse(s));
  if (!valid(start) || !valid(end) || Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 31 * 86400000) {
    throw new Error("Use UTC ISO timestamps and a positive range of at most 31 days; end is exclusive.");
  }
}
