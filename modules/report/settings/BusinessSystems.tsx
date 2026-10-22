"use client";

import { useEffect, useRef, useState } from "react";
import { ConfigButton, ConfigDetail, ConfigDetailHeader, ConfigDetailTitle, ConfigField, ConfigSidebar, ConfigSidebarItem, ConfigSidebarList, ConfigSplitView } from "@/components/SettingsUi";
import type { BusinessSystem } from "./systems";
import styles from "./settings.module.css";

const empty: BusinessSystem = { id: "", name: "", url: "", port: 9333, username: "", notes: "", usernameSelector: "", passwordSelector: "", submitSelector: "", hasPassword: false };
const fields = [
  ["name", "系统名称", "例如：警情查询系统"],
  ["url", "登录网址", "https://业务系统地址/login"],
  ["username", "账号", "建议使用专用只读账号"],
] as const;
const selectors = [["usernameSelector", "账号框 CSS 定位"], ["passwordSelector", "密码框 CSS 定位"], ["submitSelector", "登录按钮 CSS 定位"]] as const;

export function BusinessSystems() {
  const [systems, setSystems] = useState<BusinessSystem[]>([]);
  const [draft, setDraft] = useState<BusinessSystem>(empty);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/report/systems", { signal: controller.signal, cache: "no-store" })
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error); return b; })
      .then(b => { setSystems(b.systems); setLoaded(true); })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setStatus("加载配置失败，请关闭面板后重试。"); } });
    return () => controller.abort();
  }, []);
  function choose(system: BusinessSystem) {
    if (dirty && !window.confirm("放弃尚未保存的修改？")) return;
    setDraft(system); setPassword(""); setClearPassword(false); setDirty(false); setStatus(""); setFailed(false);
  }
  async function act(action: "save" | "delete" | "test" | "open" | "login") {
    if (pending.current) return;
    if (action === "delete" && !window.confirm(`删除业务系统“${draft.name}”？此操作不可撤销。`)) return;
    if (action === "login" && !window.confirm(`向已保存的网址提交登录表单？\n${draft.url}\nHTTP 会明文传输密码；验证码、扫码需人工完成。`)) return;
    pending.current = true; setBusy(true); setFailed(false); setStatus("正在处理…");
    try {
      const r = await fetch("/api/report/systems", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: draft.id, ...(action === "save" ? { system: { ...draft, password, clearPassword } } : action === "test" ? { port: draft.port } : {}) }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.error || "操作失败。");
      if (b.systems) {
        setSystems(b.systems);
        setDraft(action === "delete" ? empty : b.systems.find((s: BusinessSystem) => s.id === draft.id) ?? b.systems[b.systems.length - 1]);
        setPassword(""); setClearPassword(false); setDirty(false);
      }
      setStatus(b.message || (action === "delete" ? "已删除配置；浏览器原有登录态不会自动退出。" : "已保存。可在对话中指定系统名称，让助手打开系统查询。"));
    } catch (e) { setFailed(true); setStatus(e instanceof Error ? e.message : "操作失败，请重试。"); }
    finally { pending.current = false; setBusy(false); }
  }
  const update = (key: keyof BusinessSystem, value: string | number) => { setDraft({ ...draft, [key]: value }); setDirty(true); };
  return <div className={styles.systems}>
    <ConfigSplitView>
      <ConfigSidebar>
        <div className={styles.toolbar}><ConfigButton disabled={busy || !loaded} onClick={() => choose(empty)}>新增业务系统</ConfigButton></div>
        <ConfigSidebarList>
          {!loaded && <p className={styles.note}>{failed ? "配置加载失败" : "正在加载…"}</p>}
          {loaded && !systems.length && <p className={styles.note}>尚未配置业务系统</p>}
          {systems.map(s => <ConfigSidebarItem key={s.id} active={draft.id === s.id} disabled={busy} onClick={() => choose(s)}>{s.name}</ConfigSidebarItem>)}
        </ConfigSidebarList>
      </ConfigSidebar>
      <ConfigDetail>
        <div className={styles.form}>
          <ConfigDetailHeader><ConfigDetailTitle>{draft.id ? "编辑业务系统" : "新增业务系统"}</ConfigDetailTitle></ConfigDetailHeader>
          <p className={styles.note}>连接的是 Pi 服务所在机器上的专用 Chrome，不是当前网页浏览器。调试端口必须仅监听本机。打开/登录需要服务端 Python 和 DrissionPage；可用 REPORT_BROWSER_PYTHON 指定 Python 可执行文件。</p>
          <fieldset disabled={busy || !loaded} className={styles.fields}>
            {fields.map(([key, label, placeholder]) => <ConfigField key={key} label={label}><input className="mcp-add-input" aria-label={label} autoComplete="off" maxLength={key === "url" ? 2048 : key === "name" ? 80 : 128} value={draft[key]} placeholder={placeholder} onChange={e => update(key, e.target.value)} /></ConfigField>)}
            <ConfigField label="密码"><input className="mcp-add-input" aria-label="密码" type="password" autoComplete="new-password" maxLength={4096} disabled={clearPassword} value={password} placeholder={draft.hasPassword ? "已保存；留空保持原密码" : "请输入密码（可选）"} onChange={e => { setPassword(e.target.value); setDirty(true); }} /></ConfigField>
            <label className={styles.check}><input type="checkbox" checked={clearPassword} onChange={e => { setClearPassword(e.target.checked); setPassword(""); setDirty(true); }} />清除已保存密码</label>
            <ConfigField label="本机 Chrome 调试端口"><input className="mcp-add-input" aria-label="本机 Chrome 调试端口" type="number" min={1} max={65535} value={draft.port} onChange={e => update("port", Number(e.target.value))} /></ConfigField>
            <ConfigField label="查询说明"><textarea className="mcp-add-input" aria-label="查询说明" rows={3} maxLength={4000} value={draft.notes} placeholder="可查询内容、操作路径和限制；不要填写密码或令牌" onChange={e => update("notes", e.target.value)} /></ConfigField>
            <details className={styles.advanced}><summary>自动登录表单定位（可选）</summary>
              <p className={styles.note}>填写三个 CSS 选择器，仅支持登录网址同源的主页面表单；iframe、单点登录、验证码请人工处理。</p>
              {selectors.map(([key, label]) => <ConfigField key={key} label={label}><input className="mcp-add-input" aria-label={label} autoComplete="off" maxLength={500} value={draft[key]} placeholder={key === "passwordSelector" ? 'input[type="password"]' : key === "submitSelector" ? 'button[type="submit"]' : '#username'} onChange={e => update(key, e.target.value)} /></ConfigField>)}
            </details>
          </fieldset>
          <p className={styles.note}>更换网址、账号或浏览器端口会清除旧密码，需重新填写。密码保存在服务端私有文件中，并非加密存储；所有登录用户按可信操作员处理，共享配置及浏览器登录态。请使用 HTTPS 和只读业务账号。</p>
          {dirty && <p className={styles.note}>有未保存修改；打开和登录操作需先保存。连接测试只检查当前端口，不保存配置。</p>}
          {status && <p className={failed ? styles.error : styles.note} role={failed ? "alert" : "status"}>{status}</p>}
          <div className={styles.actions}>
            {draft.id && <ConfigButton variant="danger" disabled={busy} onClick={() => void act("delete")}>删除</ConfigButton>}
            <ConfigButton disabled={busy || !loaded} onClick={() => void act("test")}>测试连接</ConfigButton>
            <ConfigButton disabled={busy || !draft.id || dirty} onClick={() => void act("open")}>打开系统</ConfigButton>
            <ConfigButton disabled={busy || !draft.id || dirty} onClick={() => void act("login")}>提交登录</ConfigButton>
            <ConfigButton variant="primary" disabled={busy || !loaded} onClick={() => void act("save")}>保存配置</ConfigButton>
          </div>
        </div>
      </ConfigDetail>
    </ConfigSplitView>
  </div>;
}
