"use client";

import { useEffect, useState } from "react";
import styles from "./auth.module.css";

export function SessionControls() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let checking = false;
    const controller = new AbortController();
    const check = async () => {
      if (document.hidden || checking) return;
      checking = true;
      try {
        const response = await fetch("/api/web-auth", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const status = await response.json();
        if (!disposed && status.authenticated === false) {
          window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        }
      } catch {
        // A temporary outage is not a logout; the server still refuses protected requests.
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const logout = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.replace("/login");
    } catch {
      setError("退出登录失败，请重试。");
      setBusy(false);
    }
  };

  return (
    <div className={styles.account}>
      {error && <span className={styles.error} role="alert">{error}</span>}
      <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "退出中…" : "退出登录"}</button>
    </div>
  );
}
