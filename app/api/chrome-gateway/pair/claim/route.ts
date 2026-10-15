import { getChromeGateway } from "@/lib/chrome-gateway";
import { chromeGatewayPreflight, jsonError, noStoreJson, readJsonObject } from "@/lib/chrome-gateway-http";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return chromeGatewayPreflight(request);
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const result = await getChromeGateway().claimPair({
      code: typeof body.code === "string" ? body.code : "",
      name: typeof body.name === "string" ? body.name : "Chrome device",
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      token: typeof body.token === "string" ? body.token : undefined,
    });
    return noStoreJson(result, undefined, request);
  } catch (error) {
    return jsonError(error, request);
  }
}
