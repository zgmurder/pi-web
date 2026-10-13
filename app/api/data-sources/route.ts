import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { changeDataSource, listDataSources } from "@/lib/data-sources";
import { testDataSourceConnection } from "@/lib/data-source-query";
import { platformSources } from "@/lib/model-platform";
export const runtime = "nodejs";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try {
    const sources = listDataSources();
    let platform: Awaited<ReturnType<typeof platformSources>> = []; let warning: string | undefined;
    if (new URL(req.url).searchParams.get("local") !== "1") {
      try { platform = await platformSources(undefined, req.signal); }
      catch { warning = "Platform sources unavailable. Check platform settings and authorization."; }
    }
    return NextResponse.json({ sources: [...sources, ...platform], warning }, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return NextResponse.json({ error: "Cannot read data source configuration." }, { status: 500 }); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const text = await req.text();
    if (Buffer.byteLength(text) > 300000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { throw new Error("Invalid JSON request."); }
    if (!body || typeof body !== "object") throw new Error("Invalid request.");
    if (body.action === "test") {
      await testDataSourceConnection(body.source, req.signal);
      return NextResponse.json({ success: true });
    }
    if (body.action !== "save" && body.action !== "delete") throw new Error("Invalid action.");
    return NextResponse.json({ sources: await changeDataSource(body.action, body.action === "save" ? body.source : body.id) });
  } catch (error) {
    // Storage/driver errors can contain host paths or connection information.
    const message = error instanceof Error && !('code' in error) ? error.message : "Data source operation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
