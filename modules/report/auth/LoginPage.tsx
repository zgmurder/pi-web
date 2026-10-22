"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useTheme } from "@/hooks/useTheme";
import { safeLoginDestination } from "@/lib/login-destination";
import styles from "./auth.module.css";

const subscribe = () => () => {};
const browserLoginUrl = () => new URL("/api/web-auth", window.location.origin).href;
const serverLoginUrl = () => "/api/web-auth";

export function ReportLoginPage({ backendLoginUrl, demoLogin }: { backendLoginUrl: string | null; demoLogin: boolean }) {
  useTheme();
  const loginUrl = useSyncExternalStore(subscribe, browserLoginUrl, serverLoginUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "用户名或密码错误"
          : response.status === 429 ? "登录尝试过于频繁，请稍后重试。"
          : response.status >= 500 ? "Report 登录服务暂不可用，请稍后重试。" : "登录失败，请重试。");
        return;
      }
      if (demoLogin) {
        window.location.replace("/");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      const destination = safeLoginDestination(next, window.location.origin);
      window.location.replace(new URL(destination, window.location.origin).pathname === "/login" ? "/" : destination);
    } catch {
      setError("登录失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="web-login-page">
      <div className="web-login-shell">
        <header className="web-login-brand">
          <div><h1>警情分析助手</h1><p>{demoLogin ? "演示模式：任意非空用户名和密码均可登录" : "使用 Report 账号登录后继续使用"}</p></div>
        </header>
        <form className={`web-login-form ${styles.form}`} onSubmit={submit} aria-busy={busy}>
          <label htmlFor="report-username">用户名</label>
          <div className="web-login-composer">
            <input id="report-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)}
              autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={80} autoFocus required disabled={busy} />
          </div>
          <label htmlFor="report-password">密码</label>
          <div className="web-login-composer">
            <input id="report-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password" maxLength={128} required disabled={busy} />
          </div>
          <button type="submit" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
          <div className={styles.endpoints} aria-label="登录接口信息">
            <p>登录接口：<code>POST {loginUrl}</code></p>
            <p>{demoLogin ? "仅限本机演示，不校验身份、不调用认证后端；真实业务数据不可用。" : <>认证后端：{backendLoginUrl ? <code>POST {backendLoginUrl}</code> : "REPORT_API_URL 配置无效，请联系管理员"}</>}</p>
          </div>
          <p className="web-login-error" role="alert" aria-live="polite">{error}</p>
        </form>
      </div>
    </main>
  );
}
