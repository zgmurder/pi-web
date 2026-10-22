import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { changeSystem, listSystems, SystemError } from "@/modules/report/settings/systems";
import { openSystem, testBrowser } from "@/modules/report/settings/browser";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return reply({ error: "不可信的请求来源。" }, 403);
  try { return reply({ systems: listSystems() }); }
  catch { return reply({ error: "无法读取业务系统配置。" }, 500); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return reply({ error: "不可信的请求来源。" }, 403);
  if (!hasJsonContentType(request)) return reply({ error: "请求必须为 JSON。" }, 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new SystemError("请求为空。");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 20000) return reply({ error: "请求过大。" }, 413);
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new SystemError("JSON 格式不正确。"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SystemError("请求格式不正确。");
    if (body.action === "save" || body.action === "delete") return reply({ systems: await changeSystem(body.action, body.action === "save" ? body.system : body.id) });
    if (body.action === "test") return reply(await testBrowser(body.port, request.signal));
    if ((body.action === "open" || body.action === "login") && typeof body.id === "string") return reply(await openSystem(body.id, body.action, request.signal));
    throw new SystemError("不支持的操作。");
  } catch (error) {
    return reply({ error: error instanceof SystemError ? error.message : "操作失败，请检查服务配置后重试。" }, 400);
  }
}
