import { stat } from "node:fs/promises";
import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveSessionPath } from "@/lib/session-reader";
import { ChromeGatewayError, getChromeGateway } from "./gateway";
import { failure, readBody } from "./http";

export async function manageBrowser(request: Request): Promise<Response> {
  try {
    if (!isApiRequestAllowed(request)) throw new ChromeGatewayError("origin", "不可信的请求来源。", 403);
    const body = request.method === "POST" ? await readBody(request) : {};
    const sessionId = request.method === "GET" ? new URL(request.url).searchParams.get("sessionId") : body.sessionId;
    if (typeof sessionId !== "string" || !/^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$/.test(sessionId)) {
      throw new ChromeGatewayError("session", "请先打开一个已保存的对话，再连接本机浏览器。");
    }
    const path = await resolveSessionPath(sessionId);
    if (!path || !await stat(path).then(value => value.isFile(), () => false)) throw new ChromeGatewayError("session", "此对话不存在或已被删除。", 404);
    // Report operators share sessions; existence is checked here, not a per-user ACL.
    const gateway = getChromeGateway();
    let result: unknown;
    if (request.method === "GET") result = gateway.status(sessionId);
    else if (body.action === "pair") result = gateway.createPair(sessionId);
    else if (body.action === "cancel") { gateway.cancelPair(sessionId); result = { ok: true }; }
    else if (body.action === "disconnect") result = { changed: await gateway.unpair(sessionId) };
    else if (body.action === "revoke") result = { changed: await gateway.revokeBoundDevice(sessionId) };
    else throw new ChromeGatewayError("action", "不支持的操作。");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
