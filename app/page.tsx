import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { WorkspaceLayout } from "@/modules/report/components/WorkspaceLayout";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <WorkspaceLayout>
          <AppShell />
        </WorkspaceLayout>
      </I18nProvider>
    </Suspense>
  );
}
