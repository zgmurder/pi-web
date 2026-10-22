"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { detailFields, fmtGrowth, personDeptTags, trendBars } from "./model";
import type { WarningRow, WarningRuleMeta } from "./types";
import { WarningIcon } from "./WarningIcon";
import styles from "./warnings.module.css";

export function WarningDetail({ row, rule, onClose }: { row: WarningRow; rule: WarningRuleMeta; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    close.current?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const bars = trendBars(row, rule.ruleKey, rule.kind);
  const max = Math.max(...bars.map((bar) => bar.count), 1);
  const departments = rule.ruleKey === "repeatPerson90d" ? personDeptTags(row) : [];
  return createPortal(<dialog ref={dialog} className={styles.drawer} aria-labelledby="warning-detail-title" aria-describedby="warning-detail-description" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <header className={styles.drawerHeader}><h2 id="warning-detail-title">{rule.label || "预警明细"}</h2><button ref={close} type="button" className={styles.iconButton} aria-label="关闭预警明细" onClick={onClose}><WarningIcon name="close" /></button></header>
    <div className={styles.drawerBody}>
      <p id="warning-detail-description" className={styles.description}>{rule.description}</p>
      <div className={styles.warningText}>{row.warningText}</div>
      <dl className={styles.detailGrid}>{detailFields(row, rule.ruleKey, rule.kind).map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
      {bars.length > 0 && <section className={styles.trend}><h3>数量对照</h3>{bars.map((bar) => <div key={bar.label} className={styles.trendCard}>
        <div className={styles.trendLabel}><span><b>{bar.label}</b> <small>{bar.sub}</small></span><span>{bar.count} 起{bar.growth !== null ? ` · ${fmtGrowth(bar.growth)}` : ""}</span></div>
        <div className={styles.barTrack} role="img" aria-label={`${bar.label} ${bar.sub}：${bar.count} 起${bar.growth !== null ? `，${fmtGrowth(bar.growth)}` : ""}`}><div style={{ width: `${Math.max(0, bar.count / max * 100)}%` }} /></div>
      </div>)}</section>}
      {departments.length > 0 && <section className={styles.personDepartments}><h3>涉及派出所</h3><div className={styles.tags}>{departments.map((name, index) => <span className={styles.tag} key={`${name}-${index}`}>{name}</span>)}</div></section>}
    </div>
  </dialog>, document.body);
}
