"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { DataSourcePublic } from "@/lib/data-sources-shared";
import { ConfigButton, ConfigDetail, ConfigField, ConfigPanelShell, ConfigSplitView, ConfigSidebar, ConfigSidebarList, ConfigSidebarItem, ConfigDetailHeader, ConfigDetailTitle } from "./SettingsUi";
import styles from "./DataSourcesConfig.module.css";

const empty = { id: "", name: "", host: "", port: 3306, database: "", user: "", tls: true, notes: "", queries: [], hasPassword: false } satisfies DataSourcePublic;
export function DataSourcesConfig() {
  const { t } = useI18n();
  const [sources, setSources] = useState<DataSourcePublic[]>([]);
  const [draft, setDraft] = useState<DataSourcePublic>(empty);
  const [password, setPassword] = useState("");
  const [queries, setQueries] = useState("[]");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/data-sources").then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error); return b; })
      .then(b => { if (!cancelled) { setSources(b.sources); setLoaded(true); } }).catch(e => { if (!cancelled) { setStatus(e.message); setFailed(true); } });
    return () => { cancelled = true; };
  }, []);
  function choose(id: string) {
    const source = sources.find(s => s.id === id) ?? empty;
    setDraft(source); setPassword(""); setQueries(JSON.stringify(source.queries, null, 2)); setStatus(""); setFailed(false);
  }
  async function act(action: "save" | "delete" | "test") {
    if (action === "delete" && !window.confirm(t("dataSource.confirmDelete"))) return;
    setBusy(true); setFailed(false); setStatus(t(action === "test" ? "dataSource.testing" : "dataSource.working"));
    try {
      const response = await fetch("/api/data-sources", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: draft.id, ...(action !== "delete" ? { source: { ...draft, queries: action === "save" ? JSON.parse(queries.trim() || "[]") : [], ...(password || !draft.id ? { password } : {}) } } : {}) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (body.sources) {
        setSources(body.sources);
        const saved = action === "delete" ? empty : body.sources.find((s: DataSourcePublic) => s.id === draft.id) ?? body.sources[body.sources.length - 1];
        setDraft(saved); setPassword("");
        if (action === "delete") setQueries("[]");
        window.dispatchEvent(new Event("pi-web:data-sources-changed"));
      }
      setStatus(action === "test" ? t("dataSource.testOk") : t("dataSource.saved"));
    } catch (e) { setFailed(true); setStatus(e instanceof SyntaxError ? t("dataSource.invalidJson") : e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <ConfigPanelShell embedded title={t("dataSource.title")} onClose={() => {}}>
    <div className={styles.panel}>
    <ConfigSplitView>
      <ConfigSidebar>
        <div className={styles.sidebarHeader}><ConfigButton disabled={busy || !loaded} onClick={() => choose("")}>{t("dataSource.add")}</ConfigButton></div>
        <ConfigSidebarList>
          {!loaded && <p className={styles.hint}>{t(failed ? "dataSource.loadFailed" : "dataSource.loading")}</p>}
          {loaded && !sources.length && <p className={styles.hint}>{t("dataSource.empty")}</p>}
          {sources.map(s => <ConfigSidebarItem key={s.id} active={draft.id === s.id} disabled={busy} onClick={() => choose(s.id)}>
            <span className={styles.source}><strong>{s.name}</strong><small>{s.database}</small><small>{s.host}:{s.port}</small></span>
          </ConfigSidebarItem>)}
        </ConfigSidebarList>
      </ConfigSidebar>
      <div className={styles.editor}>
    <ConfigDetail>
      <div className={styles.content}>
      <ConfigDetailHeader><ConfigDetailTitle>{draft.id ? sources.find(s => s.id === draft.id)?.name ?? draft.name : t("dataSource.add")}</ConfigDetailTitle><span className={styles.badge}>MySQL</span></ConfigDetailHeader>
      <p className={styles.hint}>{t("dataSource.autoHelp")}</p>
      <section className={styles.section}>
      <h3>{t("dataSource.connection")}</h3>
      <div className={styles.fields}>
      {(["name", "host", "database", "user"] as const).map(key => <ConfigField key={key} label={t(`dataSource.${key}`)}>
        <input aria-label={t(`dataSource.${key}`)} className="mcp-add-input" value={draft[key]} disabled={busy || !loaded} autoComplete="off" onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
      </ConfigField>)}
      <ConfigField label={t("dataSource.port")}><input aria-label={t("dataSource.port")} className="mcp-add-input" type="number" min={1} max={65535} value={draft.port} disabled={busy} onChange={e => setDraft({ ...draft, port: Number(e.target.value) })} /></ConfigField>
      <ConfigField label={t("dataSource.password")}><input aria-label={t("dataSource.password")} className="mcp-add-input" type="password" autoComplete="new-password" value={password} disabled={busy} placeholder={draft.hasPassword ? t("dataSource.keepPassword") : ""} onChange={e => setPassword(e.target.value)} /></ConfigField>
      </div>
      <label className={styles.tls}><input type="checkbox" checked={draft.tls} disabled={busy} onChange={e => setDraft({ ...draft, tls: e.target.checked })} /> TLS ({t("dataSource.verifyCertificate")})</label>
      </section>
      <section className={styles.section}>
      <ConfigField label={t("dataSource.notes")}><textarea aria-label={t("dataSource.notes")} className="mcp-add-input" rows={4} value={draft.notes} disabled={busy} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></ConfigField>
      </section>
      <details className={styles.advanced}>
      <summary>{t("dataSource.queries")}</summary>
      <ConfigField label={t("dataSource.queries")}><textarea aria-label={t("dataSource.queries")} className="mcp-add-input" rows={10} spellCheck={false} value={queries} disabled={busy} onChange={e => setQueries(e.target.value)} /></ConfigField>
      <p>{t("dataSource.queryHelp")}</p>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{'[{"name":"total","description":"去重警情总量（请替换真实表和字段）","sql":"SELECT COUNT(DISTINCT alarm_id) AS total FROM alarms WHERE received_at >= :start AND received_at < :end"}]'}</pre>
      </details>
      <p className={styles.security}>{t("dataSource.security")}</p>
      </div>
    </ConfigDetail>
    <footer className={styles.footer}>
      {status && <div className={failed ? styles.error : styles.status} role={failed ? "alert" : "status"}>{status}</div>}
      <div className={styles.actions}>
        {draft.id && <ConfigButton variant="danger" disabled={busy} onClick={() => void act("delete")}>{t("dataSource.delete")}</ConfigButton>}
        <div className={styles.primaryActions}>
          <ConfigButton disabled={busy || !loaded} onClick={() => void act("test")}>{t("dataSource.test")}</ConfigButton>
          <ConfigButton variant="primary" disabled={busy || !loaded} onClick={() => void act("save")}>{t(draft.id ? "dataSource.saveChanges" : "dataSource.save")}</ConfigButton>
        </div>
      </div>
    </footer>
      </div>
    </ConfigSplitView>
    </div>
  </ConfigPanelShell>;
}
