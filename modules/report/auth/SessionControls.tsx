"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./auth.module.css";

export function SessionControls() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const accountRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const account = accountRef.current;
      if (account && !account.contains(event.target as Node)) account.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const account = accountRef.current;
      if (event.key === "Escape" && account?.open) {
        event.preventDefault();
        event.stopPropagation();
        account.open = false;
        account.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);

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
        if (!disposed) {
          if (status.authenticated === false) {
            window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          } else if (status.authenticated && typeof status.user?.username === "string") {
            setUsername(status.user.username);
          }
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
    <details
      className={styles.account}
      ref={accountRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
    >
      <summary className={styles.user} title={username || "用户信息"}>
        <span className={styles.username}>{username || "用户信息"}</span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.dropdown}>
        <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "退出中…" : "退出登录"}</button>
        {error && <span className={styles.error} role="alert">{error}</span>}
      </div>
    </details>
  );
}
