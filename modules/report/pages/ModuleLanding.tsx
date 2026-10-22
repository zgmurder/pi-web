"use client";

import { useI18n } from "@/hooks/useI18n";
import type { BusinessModule } from "../navigation";
import styles from "../components/workspace.module.css";

export function ModuleLanding({ module }: { module: BusinessModule }) {
  const { t } = useI18n();
  return (
    <main className={styles.page}>
      <div className={styles.intro}>
        <h1>{t(`workspaceNav.${module}`)}</h1>
        <p className={styles.description}>{t(`workspaceNav.${module}Description`)}</p>
        <section className={styles.notice} aria-labelledby="module-status">
          <h2 id="module-status">{t("workspaceNav.pending")}</h2>
          <p>{t("workspaceNav.pendingDescription")}</p>
        </section>
      </div>
    </main>
  );
}
