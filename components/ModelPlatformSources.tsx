"use client";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, ConfigSplitView, ConfigSidebar, ConfigSidebarList, ConfigSidebarItem, ConfigDetail, ConfigDetailHeader, ConfigDetailTitle } from "./SettingsUi";
import { ModelPlatformConfig } from "./ModelPlatformConfig";
import styles from "./DataSourcesConfig.module.css";

type Source = { id: string; name: string; notes: string };
type Metadata = { name: string; comment?: string; data_type?: string; column_key?: string };
async function request(url: string, signal: AbortSignal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error();
  return r.json();
}
export function ModelPlatformSources() {
  const { t } = useI18n();
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [config, setConfig] = useState<{ enabled: boolean; webUrl: string } | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    (async () => {
      try {
        const c = await request("/api/model-platform", controller.signal);
        if (controller.signal.aborted) return;
        setConfig(c);
        const data = c.enabled ? await request("/api/model-platform?action=sources", controller.signal) : { sources: [] };
        if (controller.signal.aborted) return;
        setSources(data.sources);
        setSelected(id => data.sources.some((s: Source) => s.id === id) ? id : data.sources[0]?.id ?? "");
      } catch { if (!controller.signal.aborted) { setError(true); setSources([]); setSelected(""); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    window.addEventListener("pi-web:data-sources-changed", refresh);
    return () => window.removeEventListener("pi-web:data-sources-changed", refresh);
  }, [refresh]);
  const source = sources.find(s => s.id === selected);
  return <div className={styles.platform}>
    <header className={styles.toolbar}>
      <div><strong>{t("dataSource.platform")}</strong><span className={styles.hint}> {sources.length ? `· ${sources.length}` : ""}</span></div>
      <div className={styles.actions}>
        <ConfigButton disabled={loading} onClick={() => window.dispatchEvent(new Event("pi-web:data-sources-changed"))}>{t("dataSource.refresh")}</ConfigButton>
        <ConfigButton onClick={() => setEditing(v => !v)}>{t(editing ? "dataSource.backToList" : "dataSource.connectionSettings")}</ConfigButton>
        {config?.webUrl && <a className={styles.manageLink} href={config.webUrl} target="_blank" rel="noopener noreferrer">{t("dataSource.platformManage")}</a>}
      </div>
    </header>
    {editing || (!loading && !error && !config?.enabled) ? <ModelPlatformConfig onSaved={() => setEditing(false)} />
      : loading ? <p className={styles.emptyState} role="status">{t("dataSource.loading")}</p>
      : error ? <p className={styles.emptyState} role="alert">{t("dataSource.platformUnavailable")}</p>
      : !sources.length ? <p className={styles.emptyState}>{t("dataSource.platformEmpty")}</p>
      : <div className={styles.panel}><ConfigSplitView>
        <ConfigSidebar><div className={styles.sidebarHeader}>{t("dataSource.sourceList")}</div><ConfigSidebarList>
          {sources.map(s => <ConfigSidebarItem key={s.id} active={selected === s.id} onClick={() => setSelected(s.id)}>
            <span className={styles.source}><strong>{s.name}</strong><small>MySQL · {t("dataSource.platform")}</small></span>
          </ConfigSidebarItem>)}
        </ConfigSidebarList></ConfigSidebar>
        <ConfigDetail>{source && <>
          <ConfigDetailHeader><ConfigDetailTitle>{source.name}</ConfigDetailTitle><span className={styles.badge}>{t("dataSource.readOnly")}</span></ConfigDetailHeader>
          <p className={styles.description}>{source.notes || t("dataSource.noDescription")}</p>
          <p className={styles.hint}>{t("dataSource.platformReadOnly")}</p>
          <SchemaList key={`${source.id}:${revision}`} sourceId={source.id} />
        </>}</ConfigDetail>
      </ConfigSplitView></div>}
  </div>;
}
function SchemaList({ sourceId, table }: { sourceId: string; table?: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Metadata[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (offset === null) return;
    const controller = new AbortController(); setLoading(true); setError(false);
    const params = new URLSearchParams({ action: "schema", id: sourceId, offset: String(offset), ...(table ? { table } : {}) });
    request(`/api/model-platform?${params}`, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setRows(previous => offset === 0 ? data.rows : [...previous, ...data.rows]); setNext(data.nextOffset);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sourceId, table, offset, retry]);
  return <section className={styles.schema}>
    <div className={styles.toolbar}><strong>{t(table ? "dataSource.columns" : "dataSource.tables")}</strong>
      {offset === null && <ConfigButton onClick={() => setOffset(0)}>{t("dataSource.loadMetadata")}</ConfigButton>}
    </div>
    {rows.map((row, index) => table ? <div className={styles.column} key={`${row.name}:${index}`}>
      <code>{row.name}</code><span>{row.data_type} {row.column_key}</span><p>{row.comment || "—"}</p>
    </div> : <div key={row.name} className={styles.tableRow}>
      <button type="button" className={styles.tableButton} aria-expanded={expanded === row.name} onClick={() => setExpanded(v => v === row.name ? null : row.name)}>
        <strong>{row.name}</strong><span>{row.comment || t("dataSource.noDescription")}</span>
      </button>
      {expanded === row.name && <SchemaList sourceId={sourceId} table={row.name} />}
    </div>)}
    {loading && <p role="status" className={styles.hint}>{t("dataSource.loading")}</p>}
    {error && <div role="alert"><p>{t("dataSource.platformUnavailable")}</p><ConfigButton onClick={() => setRetry(n => n + 1)}>{t("dataSource.retry")}</ConfigButton></div>}
    {!loading && !error && offset !== null && !rows.length && <p className={styles.hint}>{t("dataSource.noMetadata")}</p>}
    {!loading && !error && next !== null && <ConfigButton onClick={() => setOffset(next)}>{t("dataSource.loadMore")}</ConfigButton>}
  </section>;
}
