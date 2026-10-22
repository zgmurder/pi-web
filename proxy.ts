import type { NextRequest } from "next/server";
import { protectRequest } from "@/modules/report/auth/server";

export function proxy(request: NextRequest) {
  return protectRequest(request);
}

export const config = { matcher: ["/", "/report/:path*", "/login", "/api/:path*", "/report-chrome-connector.zip"] };
