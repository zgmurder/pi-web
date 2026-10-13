import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { PlatformError, platformDraft, platformSources, publicPlatformConfig, savePlatform } from "@/lib/model-platform";
import { queryPlatform } from "@/lib/model-platform-query";
export const runtime = "nodejs";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try {
    const params = new URL(req.url).searchParams;
    const action = params.get("action");
    const result = action === "sources" ? { sources: await platformSources(undefined, req.signal) }
      : action === "schema" ? await queryPlatform(params.get("id") ?? "", { action: "schema", table: params.get("table") ?? undefined, offset: Number(params.get("offset") ?? 0) }, req.signal)
      : publicPlatformConfig();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return NextResponse.json({ error: error instanceof PlatformError ? error.message : "无法读取平台配置或数据，请检查配置文件及连接设置。" }, { status: 502 }); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const raw = await req.text(); if (Buffer.byteLength(raw) > 16384) throw new Error();
    const body = JSON.parse(raw);
    if (body.action === "test") {
      const sources = await platformSources({ ...platformDraft(body.config), enabled: true }, req.signal);
      return NextResponse.json({ count: sources.length });
    }
    if (body.action !== "save") throw new Error();
    return NextResponse.json(await savePlatform(body.config));
  } catch (error) { return NextResponse.json({ error: error instanceof PlatformError ? error.message : "平台配置操作失败，请检查配置格式、配置文件权限及磁盘状态。" }, { status: 400 }); }
}
