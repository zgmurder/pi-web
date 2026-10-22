import assert from "node:assert/strict";
import test from "node:test";
import { apiGet, apiPost, apiPut, apiDelete, businessUrl, downloadReport, loginDestination, ReportApiError, safeDownloadFilename } from "./client.ts";

const ok = (data) => Response.json({ code: 0, message: "ok", data });

test("query serialization preserves original route queries, false/zero, unicode and arrays without allowing external URLs", () => {
  const url = new URL(businessUrl("/tags-v2/search?domain=x", { keyword: "中文 & ?", hasManual: false, pageNum: 0, tags: ["a", "b"], absent: null }), "http://local");
  assert.equal(url.pathname, "/api/report/business/tags-v2/search");
  assert.equal(url.searchParams.get("keyword"), "中文 & ?");
  assert.equal(url.searchParams.get("domain"), "x");
  assert.equal(url.searchParams.get("hasManual"), "false");
  assert.equal(url.searchParams.get("pageNum"), "0");
  assert.deepEqual(url.searchParams.getAll("tags"), ["a", "b"]);
  assert.equal(url.searchParams.has("absent"), false);
  for (const path of ["https://evil/x", "//evil/x", "/auth/../me", "/auth/%2e%2e/me", "/auth/me#x", "/auth/me\\x", "/auth/%252fme"]) assert.throws(() => businessUrl(path));
});

test("native fetch contract unwraps data, writes JSON, never adds bearer credentials and prevents redirects/cache", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return ok({ count: 2 }); });
  assert.deepEqual(await apiGet("/warnings/rules"), { count: 2 });
  await apiPost("/tags/packages", { name: "标签" });
  await apiPut("/tags/packages/1", { name: "更新" });
  await apiDelete("/tags/packages/1");
  assert.deepEqual(calls.map(({ init }) => init.method), ["GET", "POST", "PUT", "DELETE"]);
  assert.equal(calls[1].init.body, '{"name":"标签"}');
  for (const { init } of calls) {
    assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("handles malformed envelopes, application failures, safe HTTP errors and network errors", async (t) => {
  const responses = [Response.json({ data: [] }), Response.json({ code: 2, message: "条件有误", data: null }),
    new Response("<html>secret</html>", { status: 500 }), Response.json({ message: "无权访问" }, { status: 403 })];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  await assert.rejects(apiGet("/warnings/list"), /业务服务返回异常/);
  await assert.rejects(apiGet("/warnings/list"), /条件有误/);
  await assert.rejects(apiGet("/warnings/list"), (e) => e.status === 500 && !e.message.includes("secret"));
  await assert.rejects(apiGet("/warnings/list"), (e) => e instanceof ReportApiError && e.status === 403);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("internal-network-secret"); });
  await assert.rejects(apiGet("/warnings/list"), /无法连接业务服务/);
});

test("401 goes to login preserving only a relative route", async (t) => {
  const destinations = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/report/tags", search: "?tab=one", hash: "#details", assign: (url) => destinations.push(url) } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "window", previous) : delete globalThis.window);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "expired" }, { status: 401 }));
  await assert.rejects(apiGet("/auth/me"), (e) => e.status === 401);
  assert.deepEqual(destinations, ["/login?next=%2Freport%2Ftags%3Ftab%3Done%23details"]);
  assert.equal(loginDestination("//evil.test"), "/login?next=%2Freport");
  assert.equal(loginDestination("/\\evil.test"), "/login?next=%2Freport");
});

test("caller abort and timeout remain distinct and cover response body reads", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const pending = apiGet("/tags-v2/search", undefined, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(apiGet("/tags-v2/search", undefined, { timeout: 5 }), (e) => e.status === 504);
  await assert.rejects(apiGet("/tags-v2/search", undefined, { timeout: Infinity }), /设置无效/);
  await assert.rejects(apiGet("/tags-v2/search", undefined, { signal: AbortSignal.abort() }), { name: "AbortError" });
  t.mock.method(globalThis, "fetch", async (_url, init) => ({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })) }));
  await assert.rejects(apiGet("/auth/me", undefined, { timeout: 5 }), (e) => e.status === 504);
});

test("download forces a safe XLSX name and releases its object URL", async (t) => {
  assert.equal(safeDownloadFilename("../../evil.html\r\n"), "_.._evil.html__.xlsx");
  assert.equal(safeDownloadFilename("警情查询.xlsx"), "警情查询.xlsx");
  assert.equal(safeDownloadFilename(""), "Report.xlsx");
  let clicked = false, removed = false, revoked = false;
  const anchor = { style: {}, click() { clicked = true; }, remove() { removed = true; } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => anchor, body: { appendChild() {} } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "document", previous) : delete globalThis.document);
  t.mock.method(URL, "createObjectURL", () => "blob:download");
  t.mock.method(URL, "revokeObjectURL", () => { revoked = true; });
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms) => ms === 1000 ? (fn(), 0) : realTimeout(fn, ms));
  t.mock.method(globalThis, "fetch", async () => new Response("xlsx", { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }));
  await downloadReport("/police-events/export", { export_scope: "page" }, "警情.xlsx");
  assert.equal(anchor.download, "警情.xlsx"); assert.ok(clicked && removed && revoked);
  t.mock.method(globalThis, "fetch", async () => ok({ error: "not a workbook" }));
  await assert.rejects(downloadReport("/tags-v2/export", {}, "x"), /导出服务返回异常/);
});
