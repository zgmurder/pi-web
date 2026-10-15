import { getChromeGateway } from "@/lib/chrome-gateway";
import { jsonError, noStoreJson, requireInternalToken } from "@/lib/chrome-gateway-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireInternalToken(request);
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
    return noStoreJson(getChromeGateway().status(sessionId));
  } catch (error) {
    return jsonError(error);
  }
}
