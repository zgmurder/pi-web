"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { isWorkspaceItemActive, workspaceItems } from "../navigation";
import styles from "./workspace.module.css";
import { SessionControls } from "../auth/SessionControls";
import { WorkspaceSettings } from "../settings/WorkspaceSettings";
import { WorkspaceLogo } from "./WorkspaceLogo";

export function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  useTheme();

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <span className={styles.brand}><WorkspaceLogo /></span>
        <nav className={styles.navigation} aria-label={t("workspaceNav.label")}>
          {workspaceItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              prefetch={false}
              aria-current={isWorkspaceItemActive(pathname, item.href) ? "page" : undefined}
              className={styles.link}
            >
              {t(item.label)}
            </Link>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <WorkspaceSettings />
          <SessionControls />
        </div>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
