"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DepartmentScope, DeptNode } from "./types";
import styles from "./warnings.module.css";

function branchKeys(nodes: DeptNode[]): string[] {
  return nodes.flatMap((node) => node.children?.length ? [node.key, ...branchKeys(node.children)] : []);
}
function filterNodes(nodes: DeptNode[], keyword: string): DeptNode[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterNodes(node.children || [], keyword);
    return node.label.toLowerCase().includes(query) || children.length ? [{ ...node, children }] : [];
  });
}
export function DepartmentSelect({ scope, value, onChange, disabled }: { scope: DepartmentScope; value: string; onChange: (key: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState(() => new Set(branchKeys(scope.tree).slice(0, 12)));
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const nodes = useMemo(() => filterNodes(scope.tree, keyword), [scope.tree, keyword]);
  const selected = scope.options.find((dept) => String(dept.deptId) === value);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const select = (key: string) => { onChange(key); setOpen(false); setKeyword(""); buttonRef.current?.focus(); };
  const renderNodes = (items: DeptNode[], depth = 0) => items.map((node) => <li key={node.key}>
    <div className={styles.deptRow} style={{ paddingLeft: depth * 16 }}>
      {Boolean(node.children?.length) ? <button type="button" aria-label={`${expanded.has(node.key) ? "折叠" : "展开"}${node.label}`} aria-expanded={Boolean(keyword) || expanded.has(node.key)} className={styles.treeToggle} onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(node.key)) next.delete(node.key); else next.add(node.key); return next; })}>{keyword || expanded.has(node.key) ? "−" : "+"}</button> : <span className={styles.treeSpacer} />}
      <button type="button" className={styles.deptOption} aria-pressed={value === node.key} onClick={() => select(node.key)}>{node.label}</button>
    </div>
    {node.children?.length && (keyword || expanded.has(node.key)) ? <ul>{renderNodes(node.children, depth + 1)}</ul> : null}
  </li>);
  return <div className={styles.departmentSelect} ref={ref} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); } }}>
    <button ref={buttonRef} type="button" className={styles.deptTrigger} disabled={disabled} aria-expanded={open} aria-label="部门" onClick={() => setOpen(!open)} title={selected?.deptName}>{selected?.deptName || (scope.isCityBureau ? "部门（市局可查全部）" : "部门（仅本部门）")}<span aria-hidden="true">⌄</span></button>
    {open && <div className={styles.deptPopup}>
      <input autoFocus type="search" aria-label="搜索部门" placeholder="搜索部门" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      {scope.isCityBureau && <button type="button" className={styles.deptOption} onClick={() => select("")}>全部部门</button>}
      <ul aria-label="部门列表">{renderNodes(nodes)}</ul>
      {!nodes.length && <p className={styles.empty}>暂无部门</p>}
    </div>}
  </div>;
}
