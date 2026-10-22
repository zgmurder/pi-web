import { ChromeGatewayError, getChromeGateway } from "./gateway";
import { deviceHeaders, isDeviceRequestAllowed } from "./device-security";
import { hasJsonContentType } from "@/lib/request-security";

export async function readBody(request: Request, limit = 16_384): Promise<Record<string, unknown>> {
  if (!hasJsonContentType(request)) throw new ChromeGatewayError("content-type", "请求必须为 JSON。", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ChromeGatewayError("body", "请求体不能为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ChromeGatewayError("size", "请求过大。", 413); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ChromeGatewayError) throw error;
    throw new ChromeGatewayError("body", "无效 JSON 请求。");
  } finally { reader.releaseLock(); }
}
export function failure(error: unknown, headers?: Headers): Response {
  return Response.json({ error: error instanceof ChromeGatewayError ? error.message : "浏览器操作失败，请稍后重试。" }, {
    status: error instanceof ChromeGatewayError ? error.status : 500,
    headers: headers ?? { "Cache-Control": "no-store" },
  });
}
export async function deviceRequest(request: Request): Promise<Response> {
  const headers = deviceHeaders(request);
  try {
    if (!isDeviceRequestAllowed(request)) throw new ChromeGatewayError("origin", "不可信的扩展来源。", 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const gateway = getChromeGateway();
    const url = new URL(request.url);
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    if (url.pathname === "/api/chrome-gateway/pair/claim" && request.method === "POST") {
      const body = await readBody(request);
      if (typeof body.code !== "string" || body.code.length > 100 || typeof body.name !== "string" || body.name.length > 160) throw new ChromeGatewayError("pair", "无效配对请求。");
      const result = await gateway.claimPair({ code: body.code, name: body.name,
        deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
        token: typeof body.token === "string" ? body.token : undefined });
      return Response.json(result, { headers });
    }
    if (url.pathname === "/api/chrome-gateway/device/next" && request.method === "GET") {
      const command = await gateway.nextCommand(url.searchParams.get("deviceId") ?? "", token,
        { clientName: url.searchParams.get("name") ?? undefined, extensionVersion: url.searchParams.get("version") ?? undefined }, request.signal);
      return command ? Response.json(command, { headers }) : new Response(null, { status: 204, headers });
    }
    if (url.pathname === "/api/chrome-gateway/device/result" && request.method === "POST") {
      const body = await readBody(request, 2 * 1024 * 1024);
      if (typeof body.deviceId !== "string" || typeof body.id !== "string" || typeof body.ok !== "boolean") throw new ChromeGatewayError("result", "无效执行结果。");
      gateway.submitResult(body.deviceId, token, { id: body.id, ok: body.ok, result: body.result,
        error: typeof body.error === "string" ? body.error.slice(0, 2000) : undefined });
      return Response.json({ ok: true }, { headers });
    }
    throw new ChromeGatewayError("route", "接口不存在。", 404);
  } catch (error) { return failure(error, headers); }
}
