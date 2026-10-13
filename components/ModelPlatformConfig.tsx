"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, ConfigField } from "./SettingsUi";

export function ModelPlatformConfig({ onSaved }: { onSaved?: () => void }) {
  const { t } = useI18n();
  const [config, setConfig] = useState({ enabled: false, apiUrl: "http://127.0.0.1:9300", webUrl: "http://127.0.0.1:5180", authType: "bearer", hasApiKey: false });
  const [key, setKey] = useState(""); const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState(""); const [error, setError] = useState(false);
  const [manageUrl, setManageUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/model-platform").then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(c => {
      if (!cancelled) { setConfig(c); setManageUrl(c.webUrl); setLoaded(true); }
    }).catch(() => { if (!cancelled) { setError(true); setStatus(t("dataSource.loadFailed")); } });
    return () => { cancelled = true; };
  }, [t]);
  async function act(action: "save" | "test") {
    setBusy(true); setError(false); setStatus(t("dataSource.working"));
    try {
      const r = await fetch("/api/model-platform", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, config: { ...config, ...(clearKey ? { apiKey: "" } : key ? { apiKey: key } : {}) } }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.error);
      if (action === "save") { setConfig(b); setManageUrl(b.webUrl); setKey(""); setClearKey(false); onSaved?.(); window.dispatchEvent(new Event("pi-web:data-sources-changed")); }
      setStatus(action === "save" ? t("dataSource.saved") : `${t("dataSource.platformTestOk")} (${b.count})`);
    } catch (e) { setError(true); setStatus(e instanceof Error ? e.message : t("dataSource.loadFailed")); }
    finally { setBusy(false); }
  }
  return <section style={{ padding: 20, maxWidth: 640, width: "100%", boxSizing: "border-box", margin: "0 auto", overflowY: "auto" }}>
    <h3>{t("dataSource.connectionSettings")}</h3>
    <p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("dataSource.platformHelp")}</p>
    <fieldset disabled={busy || !loaded} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
      <label><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /> {t("dataSource.platformEnabled")}</label>
      {(["apiUrl", "webUrl"] as const).map(field => <ConfigField key={field} label={t(`dataSource.${field}`)}>
        <input className="mcp-add-input" aria-label={t(`dataSource.${field}`)} value={config[field]} onChange={e => setConfig({ ...config, [field]: e.target.value })} />
      </ConfigField>)}
      <ConfigField label={t("dataSource.authType")}><select className="mcp-add-input" aria-label={t("dataSource.authType")} value={config.authType} onChange={e => { setConfig({ ...config, authType: e.target.value }); setKey(""); setClearKey(false); }}>
        <option value="bearer">{t("dataSource.loginToken")}</option><option value="apiKey">X-API-Key</option>
      </select></ConfigField>
      <p>{t("dataSource.tokenHelp")}</p>
      <ConfigField label={config.authType === "bearer" ? t("dataSource.loginToken") : "API Key"}><input aria-label={config.authType === "bearer" ? t("dataSource.loginToken") : "API Key"} className="mcp-add-input" type="password" autoComplete="new-password" value={key} disabled={clearKey}
        placeholder={config.hasApiKey ? t("dataSource.keepPassword") : ""} onChange={e => setKey(e.target.value)} /></ConfigField>
      {config.hasApiKey && <label><input type="checkbox" checked={clearKey} onChange={e => setClearKey(e.target.checked)} /> {t("dataSource.clearKey")}</label>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <ConfigButton onClick={() => void act("test")}>{t("dataSource.test")}</ConfigButton>
        <ConfigButton variant="primary" onClick={() => void act("save")}>{t("dataSource.save")}</ConfigButton>
        {manageUrl && <a href={manageUrl} target="_blank" rel="noopener noreferrer">{t("dataSource.platformManage")}</a>}
      </div>
    </fieldset>
    {status && <p role={error ? "alert" : "status"}>{status}</p>}
  </section>;
}
