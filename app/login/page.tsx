import { ReportLoginPage } from "@/modules/report/auth/LoginPage";
import { reportApiOrigin } from "@/modules/report/api/policy";

// Show the running instance's configuration, not the build machine's address.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  let backendLoginUrl: string | null = null;
  try {
    backendLoginUrl = new URL("/api/v1/auth/login", reportApiOrigin()).href;
  } catch {
    // Invalid configuration can contain credentials; never render the raw value.
  }
  return <ReportLoginPage backendLoginUrl={backendLoginUrl} />;
}
