import { getChromeGateway } from "@/lib/chrome-gateway";
import { ChromeGatewayError } from "@/lib/chrome-gateway";
import { jsonError, noStoreJson, readJsonObject, requireInternalToken } from "@/lib/chrome-gateway-http";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    requireInternalToken(request);
    const body = await readJsonObject(request);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const action = body.action;
    if (action === "unpair") return noStoreJson({ changed: await getChromeGateway().unpair(sessionId) });
    if (action === "revoke-device") return noStoreJson({ changed: await getChromeGateway().revokeBoundDevice(sessionId) });
    throw new ChromeGatewayError("invalid-action", "Action must be unpair or revoke-device");
  } catch (error) {
    return jsonError(error);
  }
}
