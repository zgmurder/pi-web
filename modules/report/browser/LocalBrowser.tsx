"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConfigButton, ConfigDetailStack, ConfigNotice } from "@/components/SettingsUi";
import styles from "./LocalBrowser.module.css";

type Connector = { installed?: boolean; trusted?: boolean; deviceId?: string; error?: string };
type Status = { paired?: boolean; connected?: boolean; deviceId?: string; deviceName?: string };

function connector(action: "status" | "pair", fields: Record<string, unknown> = {}): Promise<Connector> {
  return new Promise((resolve, reject) => {
    // getRandomValues works on HTTP intranets too; randomUUID does not.
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("");
    const finish = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "report-connector" || event.data.id !== id) return;
      finish();
      if (event.data.response?.error) reject(new Error(event.data.response.error));
      else resolve(event.data.response ?? {});
    };
    const timer = setTimeout(() => { finish(); reject(new Error("未检测到已授权扩展：请先安装，从扩展图标信任当前站点，然后刷新页面。")); }, 3000);
    window.addEventListener("message", receive);
    window.postMessage({ source: "report-web", id, action, ...fields }, location.origin);
  });
}
async function api(sessionId: string, action?: string) {
  const response = await fetch(`/api/report/browser${action ? "" : `?sessionId=${encodeURIComponent(sessionId)}`}`, {
    method: action ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(12_000),
    ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, action }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "连接请求失败。");
  return result;
}

function BrowserSession({ sessionId }: { sessionId: string }) {
  const [local, setLocal] = useState<Connector>({});
  const [status, setStatus] = useState<Status>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    let checking = false;
    const check = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const [remote, extension] = await Promise.all([sessionId ? api(sessionId) : Promise.resolve({}), connector("status").catch(() => ({}))]);
        if (!disposed) { setStatus(remote); setLocal(extension); }
      } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : "无法检查连接。"); }
      finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [sessionId]);

  async function act(action: "pair" | "cancel" | "disconnect" | "revoke") {
    if (busy) return;
    if (action === "pair" && !window.confirm(`将本机 Chrome 授权给当前会话：${sessionId}\n每次浏览器工具操作仍会请求确认；页面数据可能发送给模型。HTTP 连接会明文传输，请仅在可信内网使用。`)) return;
    if (action === "revoke" && !window.confirm("撤销此设备的全部会话连接？已送出的操作可能完成，业务系统登录态不会退出。")) return;
    setBusy(true); setMessage("");
    try {
      if (action === "pair") {
        await connector("status");
        const pair = await api(sessionId, "pair");
        try { await connector("pair", { code: pair.code, sessionId }); }
        catch (error) { await api(sessionId, "cancel").catch(() => {}); throw error; }
        setMessage("请在两分钟内点击浏览器工具栏的扩展图标，核对会话并确认连接；此处会自动更新状态。");
      } else { await api(sessionId, action); setMessage(action === "cancel" ? "待确认连接已取消。" : "连接已断开；已送出的操作可能完成，不会注销业务系统。"); }
      setStatus(await api(sessionId));
    } catch (error) { setMessage(error instanceof Error ? error.message : "浏览器操作失败。"); }
    finally { setBusy(false); }
  }
  const ours = Boolean(local.deviceId && local.deviceId === status.deviceId);
  return <ConfigDetailStack className={styles.panel}>
    <header className={styles.header}>
      <span className={styles.icon}>
        {/* Lucide Chrome icon, ISC license. */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M21.17 8H12M3.95 6.06 8.54 14M10.88 21.94 15.46 14"/></svg>
      </span>
      <div><h2>本机浏览器</h2><p>连接您电脑上的 Chrome，沿用已有业务登录态。</p></div>
    </header>

    <section className={styles.card} aria-label="当前连接">
      <div className={styles.cardHeading}>
        <h3>当前连接</h3>
        <span className={styles.badge} data-online={Boolean(status.paired && status.connected)} role="status">
          <span className={styles.dot} aria-hidden="true" />
          {status.paired ? (status.connected ? "设备在线" : "设备离线") : "待连接"}
        </span>
      </div>
      <dl className={styles.statusGrid}>
        <div><dt>浏览器扩展</dt><dd>{local.installed ? "已检测到 · 已信任本站点" : "未检测到扩展"}</dd></div>
        <div><dt>绑定设备</dt><dd>{status.paired ? (ours ? "本机 Chrome" : "其他浏览器设备") : "尚未绑定"}</dd></div>
        <div className={styles.session}><dt>当前会话</dt><dd>{sessionId ? <code>{sessionId}</code> : "尚未选择已保存的对话"}</dd></div>
      </dl>
      <div className={styles.connect}>
        <ConfigButton variant="primary" disabled={busy || !sessionId || !local.installed} onClick={() => void act("pair")}>
          {status.paired ? "重新连接本机" : "连接本机浏览器"}
        </ConfigButton>
        <p>{!sessionId ? "请先回到对话页，打开一个已保存的对话。" : !local.installed ? "请先安装扩展并信任本站点，然后刷新页面。" : "仅授权当前会话，连接后还需在扩展中确认。"}</p>
      </div>
      <div className={styles.secondaryActions}>
        <div>
          <ConfigButton variant="ghost" size="small" disabled={busy || !sessionId} onClick={() => void act("cancel")}>取消待确认连接</ConfigButton>
          <ConfigButton variant="ghost" size="small" disabled={busy || !status.paired} onClick={() => void act("disconnect")}>断开此会话</ConfigButton>
        </div>
        <ConfigButton variant="danger" size="small" disabled={busy || !status.paired} onClick={() => void act("revoke")}>撤销设备</ConfigButton>
      </div>
      {message && <ConfigNotice>{message}</ConfigNotice>}
    </section>

    <section className={styles.card} aria-label="首次安装指引">
      <div className={styles.cardHeading}><h3>首次使用 · 三步连接</h3><span className={styles.caption}>安装一次，后续无需重复</span></div>
      <ol className={styles.steps}>
        <li><span className={styles.stepNumber} aria-hidden="true">1</span><div><h4>下载扩展</h4><p>下载离线包，解压到固定目录。</p><a className={`config-button config-button-secondary config-button-small ${styles.download}`} href="/report-chrome-connector.zip" download>下载 Chrome 扩展</a></div></li>
        <li><span className={styles.stepNumber} aria-hidden="true">2</span><div><h4>安装并信任</h4><p>加载扩展，信任助手站点后刷新。</p></div></li>
        <li><span className={styles.stepNumber} aria-hidden="true">3</span><div><h4>连接当前会话</h4><p>点击连接，再从扩展图标确认。</p></div></li>
      </ol>
      <details className={styles.details}>
        <summary>查看详细安装步骤</summary>
        <ol className={styles.instructions}>
          <li>在 Chrome 地址栏打开 <code>chrome://extensions</code>，开启“开发者模式”。</li>
          <li>点击“加载已解压的扩展程序”，选择含 <code>manifest.json</code> 的文件夹。首次安装不能由普通网页自动完成。</li>
          <li>返回本网页，从浏览器工具栏打开扩展，核对地址并“信任当前站点”，然后刷新网页。</li>
          <li>打开已有对话，点击上方连接按钮，再从扩展图标核对会话并确认。无需填写地址、设备名或配对码。</li>
        </ol>
      </details>
    </section>

    <aside className={styles.safety} aria-label="安全提醒">
      <p><strong>安全提醒</strong>扩展具有广泛浏览器权限，建议使用内网 HTTPS。密码、验证码、扫码和 UKey 请在业务页面人工处理，不要发送到对话。</p>
      <details className={styles.details}>
        <summary>安全与使用说明</summary>
        <ul className={styles.instructions}>
          <li>这是您当前电脑的 Chrome，不是服务器的 9333 浏览器。仅对明确连接的会话生效，新会话不会继承设备。</li>
          <li>HTTP 会明文传输设备凭证和页面内容；浏览器工具每次操作仍需确认，页面数据可能进入模型与会话。</li>
          <li>停止接收所有命令：在扩展中点击“停止并忘记站点”。断开不会关闭业务标签页或注销账号，已送出的操作可能完成。</li>
          <li>所有登录账号仍属于可信操作员共享环境，设备绑定不等于用户权限隔离。</li>
        </ul>
      </details>
    </aside>
  </ConfigDetailStack>;
}
export function LocalBrowser() {
  const params = useSearchParams();
  const sessionId = params.get("session") || "";
  return <BrowserSession key={sessionId} sessionId={sessionId} />;
}
