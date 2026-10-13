"use client";
import { useEffect, useId, useRef, useState } from "react";
import { SelectorRow } from "./SelectorRow";
import { useIsMobile } from "@/hooks/useIsMobile";
import styles from "./DataSourceSelector.module.css";
import { useI18n } from "@/hooks/useI18n";
import { sendAgentCommand } from "@/lib/agent-client";
import type { DataSourcePublic } from "@/lib/data-sources-shared";

export function DataSourceSelector({ sessionId, branchId, ensureSession, disabled, chatOnly, onManage }: {
  sessionId?: string | null; branchId?: string | null; ensureSession: () => Promise<string | null>; disabled: boolean; chatOnly: boolean; onManage: () => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const popupId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const visible = open && !disabled && !busy;
  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }
    };
    const first = root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)') ?? root.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
    first?.focus();
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [visible]);
  const [sources, setSources] = useState<(Pick<DataSourcePublic, "id" | "name"> & { origin?: "platform" })[]>([]);
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/data-sources"); const b = await r.json(); if (!r.ok) throw new Error(b.error);
        const selection = sessionId ? await sendAgentCommand<{ id: string | null }>(sessionId, { type: "get_data_source" }) : { id: null };
        if (!cancelled) { setSources(b.sources); setId(selection.id ?? ""); setError(b.warning ?? ""); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load(); window.addEventListener("pi-web:data-sources-changed", load);
    return () => { cancelled = true; window.removeEventListener("pi-web:data-sources-changed", load); };
  }, [sessionId, branchId, disabled]);
  async function select(value: string) {
    if (disabled || busy || (chatOnly && value && value !== "__manage__")) return;
    setOpen(false); trigger.current?.focus();
    if (value === "__manage__") { onManage(); return; }
    setBusy(true); setError("");
    try {
      const sid = sessionId ?? await ensureSession();
      if (!sid) throw new Error(t("dataSource.sessionRequired"));
      await sendAgentCommand(sid, { type: "set_data_source", dataSourceId: value || null });
      setId(value);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const label = id ? sources.find(s => s.id === id)?.name ?? t("dataSource.missing") : t("dataSource.none");
  return <div ref={root} className={styles.root} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className={styles.trigger} title={`${t("dataSource.title")}: ${label}`}
      aria-label={`${t("dataSource.title")}: ${label}`} aria-haspopup="listbox" aria-expanded={visible} aria-controls={visible ? popupId : undefined}
      disabled={disabled || busy} onClick={() => setOpen(v => !v)}
      onKeyDown={e => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}>
      <span className={styles.label}>{label}</span>
    </button>
    {visible && <div id={popupId} role="listbox" aria-label={t("dataSource.title")} className={styles.popup}
      style={isMobile ? { left: 0 } : { right: 0 }} onKeyDown={e => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const options = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      }}>
      <SelectorRow active={!id} onSelect={() => void select("")}>{t("dataSource.none")}</SelectorRow>
      {id && !sources.some(s => s.id === id) && <div className={styles.note}>{t("dataSource.missing")}</div>}
      {chatOnly && <div className={styles.note}>{t("dataSource.chatOnly")}</div>}
      <fieldset disabled={chatOnly} className={styles.sources}>
        {sources.map(s => <SelectorRow key={s.id} active={s.id === id} onSelect={() => void select(s.id)}><span className={styles.label} title={s.name}>{s.name}{s.origin === "platform" ? ` · ${t("dataSource.platform")}` : ""}</span></SelectorRow>)}
      </fieldset>
      <div className={styles.manage}><SelectorRow active={false} onSelect={() => void select("__manage__")}>{t("dataSource.manage")}</SelectorRow></div>
    </div>}
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </div>;
}
