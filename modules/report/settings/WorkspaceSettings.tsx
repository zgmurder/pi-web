"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfigButton, ConfigPanelShell } from "@/components/SettingsUi";
import { DataSourcesConfig } from "@/components/DataSourcesConfig";
import { BusinessSystems } from "./BusinessSystems";
import { LocalBrowser } from "../browser/LocalBrowser";
import { useI18n } from "@/hooks/useI18n";
import styles from "./settings.module.css";

function Panel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<"sources" | "systems" | "browser">("sources");
  useEffect(() => {
    const opener = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-label="业务配置" onCancel={onClose}
    onKeyDown={e => { if (e.key === "Escape") e.stopPropagation(); }}>
    <ConfigPanelShell embedded title="业务配置" onClose={onClose}>
      <header className={styles.heading}><strong>业务配置</strong><ConfigButton onClick={onClose}>关闭</ConfigButton></header>
      <div className={styles.tabs} role="group" aria-label="配置分类">
        <ConfigButton aria-pressed={section === "sources"} onClick={() => setSection("sources")}>数据源</ConfigButton>
        <ConfigButton aria-pressed={section === "systems"} onClick={() => setSection("systems")}>业务系统（服务器浏览器）</ConfigButton>
        <ConfigButton aria-pressed={section === "browser"} onClick={() => setSection("browser")}>本机浏览器</ConfigButton>
      </div>
      <div className={styles.body} hidden={section !== "sources"}><DataSourcesConfig /></div>
      <div className={styles.body} hidden={section !== "systems"}><BusinessSystems /></div>
      {section === "browser" && <div className={styles.body}><LocalBrowser /></div>}
    </ConfigPanelShell>
  </dialog>, document.body);
}

export function WorkspaceSettings() {
  const [open, setOpen] = useState(false);
  const { setLocale } = useI18n();
  return <>
    <button type="button" className={styles.gear} aria-label="业务配置" title="业务配置" aria-haspopup="dialog" onClick={() => { setLocale("zh-CN"); setOpen(true); }}>
      {/* Lucide settings icon, ISC license. */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 1.72l-.12.88a2 2 0 0 1-1.18 1.52l-.18.08a2 2 0 0 1-1.9-.18l-.71-.54a2 2 0 0 0-2.61.54l-.22.38a2 2 0 0 0 .39 2.63l.71.55a2 2 0 0 1 .73 1.75v.2a2 2 0 0 1-.73 1.75l-.71.55a2 2 0 0 0-.39 2.63l.22.38a2 2 0 0 0 2.61.54l.71-.54a2 2 0 0 1 1.9-.18l.18.08a2 2 0 0 1 1.18 1.52l.12.88a2 2 0 0 0 2 1.72h.44a2 2 0 0 0 2-1.72l.12-.88a2 2 0 0 1 1.18-1.52l.18-.08a2 2 0 0 1 1.9.18l.71.54a2 2 0 0 0 2.61-.54l.22-.38a2 2 0 0 0-.39-2.63l-.71-.55a2 2 0 0 1-.73-1.75v-.2a2 2 0 0 1 .73-1.75l.71-.55a2 2 0 0 0 .39-2.63l-.22-.38a2 2 0 0 0-2.61-.54l-.71.54a2 2 0 0 1-1.9.18l-.18-.08a2 2 0 0 1-1.18-1.52l-.12-.88a2 2 0 0 0-2-1.72z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    {open && <Panel onClose={() => setOpen(false)} />}
  </>;
}
