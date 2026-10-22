import { I18nProvider } from "@/hooks/useI18n";
import { WorkspaceLayout } from "@/modules/report/components/WorkspaceLayout";

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <WorkspaceLayout>{children}</WorkspaceLayout>
    </I18nProvider>
  );
}
