import { getChromeGateway } from "@/lib/chrome-gateway";
import { bearerToken, chromeGatewayPreflight, jsonError, noStoreJson } from "@/lib/chrome-gateway-http";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(request: Request) {
  return chromeGatewayPreflight(request);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId") ?? "";
    const token = bearerToken(request) ?? "";
    const command = await getChromeGateway().nextCommand(deviceId, token, {
      clientName: url.searchParams.get("name") ?? undefined,
      extensionVersion: url.searchParams.get("version") ?? undefined,
    }, request.signal);
    return command ? noStoreJson(command, undefined, request) : chromeGatewayPreflight(request);
  } catch (error) {
    return jsonError(error, request);
  }
}
