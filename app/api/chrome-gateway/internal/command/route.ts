import { getChromeGateway } from "@/lib/chrome-gateway";
import { jsonError, noStoreJson, readJsonObject, requireInternalToken } from "@/lib/chrome-gateway-http";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    requireInternalToken(request);
    const body = await readJsonObject(request);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const action = typeof body.action === "string" ? body.action : "";
    const params = typeof body.params === "object" && body.params !== null && !Array.isArray(body.params)
      ? body.params as Record<string, unknown>
      : {};
    const timeoutMs = typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs)
      ? Math.min(Math.max(Math.floor(body.timeoutMs), 1_000), 110_000)
      : 30_000;
    const expectedVersion = typeof body.expectedExtensionVersion === "string" ? body.expectedExtensionVersion : undefined;
    const result = await getChromeGateway().sendCommand(sessionId, action, params, timeoutMs, expectedVersion, request.signal);
    return noStoreJson({ result });
  } catch (error) {
    return jsonError(error);
  }
}
