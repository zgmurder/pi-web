import { getChromeGateway } from "@/lib/chrome-gateway";
import { jsonError, noStoreJson, readJsonObject, requireInternalToken } from "@/lib/chrome-gateway-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireInternalToken(request);
    const body = await readJsonObject(request);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    return noStoreJson(getChromeGateway().createPair(sessionId));
  } catch (error) {
    return jsonError(error);
  }
}
