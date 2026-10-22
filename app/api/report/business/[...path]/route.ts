import type { NextRequest } from "next/server";
import { proxyReportBusiness } from "@/modules/report/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyReportBusiness(request, path, request.cookies.get("report_access_token")?.value);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
