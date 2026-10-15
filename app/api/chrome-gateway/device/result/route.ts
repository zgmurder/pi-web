import { getChromeGateway } from "@/lib/chrome-gateway";
import { bearerToken, chromeGatewayPreflight, jsonError, noStoreJson, readJsonObject } from "@/lib/chrome-gateway-http";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return chromeGatewayPreflight(request);
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    getChromeGateway().submitResult(
      typeof body.deviceId === "string" ? body.deviceId : "",
      bearerToken(request) ?? "",
      {
        id: typeof body.id === "string" ? body.id : "",
        ok: body.ok === true,
        result: body.result,
        error: typeof body.error === "string" ? body.error : undefined,
      },
    );
    return noStoreJson({ ok: true }, undefined, request);
  } catch (error) {
    return jsonError(error, request);
  }
}
