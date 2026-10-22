import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { proxyReportBusiness, readBoundedJson, MAX_BUSINESS_BODY_BYTES } = await jiti.import("./server.ts");
const TOKEN = "header.payload.signature";
const origin = "http://localhost:30141";
const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const req = (path, method = "GET", body, headers = {}, signal) => new Request(`${origin}/api/report/business${path}`, {
  method, headers: { host: "localhost:30141", origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }), signal,
});
const proxy = (request, token = TOKEN) => proxyReportBusiness(request, new URL(request.url).pathname.replace("/api/report/business/", "").split("/"), token);
const ok = (data) => Response.json({ code: 0, message: "ok", data });

test("proxy checks host/origin, cookie and exact route before any fetch", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  for (const [request, token, status] of [
    [req("/auth/me", "GET", undefined, { host: "evil.test" }), TOKEN, 403],
    [req("/auth/me", "GET", undefined, { origin: "http://evil.test" }), TOKEN, 403],
    [req("/auth/me", "GET", undefined, { "sec-fetch-site": "cross-site" }), TOKEN, 403],
    [req("/auth/me"), "", 401], [req("/auth/login", "POST", {}), TOKEN, 404],
    [req("/tags-v2/search", "POST", {}), TOKEN, 404], [req("/users"), TOKEN, 404],
  ]) assert.equal((await proxy(request, token)).status, status);
  assert.equal((await proxyReportBusiness(req("/auth/me"), ["auth", "../me"], TOKEN)).status, 404);
  assert.equal(fetch.mock.calls.length, 0);
});

test("only fixed origin, bearer token and approved headers reach upstream; response headers cannot set cookies", async (t) => {
  const before = process.env.REPORT_API_URL;
  process.env.REPORT_API_URL = "http://127.0.0.1:8001";
  t.after(() => before === undefined ? delete process.env.REPORT_API_URL : process.env.REPORT_API_URL = before);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ code: 0, message: "ok", data: { unit_code: "123", roles: ["user"] } }), {
      headers: { "content-type": "application/json", "set-cookie": "secret=1", location: "https://evil.test", "x-debug-token": TOKEN },
    });
  });
  const response = await proxy(req("/auth/me?url=https://evil.test", "GET", undefined, {
    authorization: "Bearer attacker", cookie: "other=secret", "x-forwarded-host": "evil.test", "x-user-role": "admin",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { unit_code: "123", roles: ["user"] });
  assert.equal(calls[0].url.origin, "http://127.0.0.1:8001");
  assert.equal(calls[0].url.pathname, "/api/v1/auth/me");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ["Accept", "Authorization"]);
  assert.equal(calls[0].init.cache, "no-store"); assert.equal(calls[0].init.redirect, "error");
  assert.match(response.headers.get("cache-control"), /no-store/);
  for (const name of ["set-cookie", "location", "x-debug-token"]) assert.equal(response.headers.has(name), false);
  process.env.REPORT_API_URL = "http://127.0.0.1:8001/path";
  assert.equal((await proxy(req("/auth/me"))).status, 503);
  assert.equal(calls.length, 1);
});

test("JSON bodies bounded by actual bytes, checked for content type/shape and preserved for backend authorization", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => { calls.push(init); return ok({ total: 0, items: [] }); });
  const data = { unit_code: "other-dept", tag_names: ["测试"], page: 2, page_size: 20 };
  assert.equal((await proxy(req("/police-events/search", "POST", data))).status, 200);
  assert.deepEqual(JSON.parse(calls[0].body), data);
  for (const [body, headers, status] of [
    ["{}", { "content-type": "text/plain" }, 415], ["{}", { "content-encoding": "gzip" }, 415],
    ["{}", { "content-length": String(MAX_BUSINESS_BODY_BYTES + 1) }, 413],
    ["{", {}, 400], ["null", {}, 400], ["[]", {}, 400],
    [JSON.stringify({ huge: "中".repeat(MAX_BUSINESS_BODY_BYTES / 3) }), {}, 413],
  ]) assert.equal((await proxy(req("/police-events/search", "POST", body, headers))).status, status);
  assert.equal(calls.length, 1);
});

test("backend errors and invalid envelopes never leak diagnostic bodies", async (t) => {
  const responses = [
    new Response("SQL password=secret", { status: 500 }), new Response("token=secret", { status: 401 }),
    new Response("private dept", { status: 403 }), new Response("invalid values", { status: 422 }),
    new Response("redirect", { status: 302, headers: { location: "https://evil.test" } }),
    Response.json({ code: 5, message: "SQL secret", data: null }),
    Response.json({ code: 0, message: "secret" }), new Response("<html>secret</html>"),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  for (const status of [502, 401, 403, 422, 502, 400, 502, 502]) {
    const response = await proxy(req("/auth/me"));
    assert.equal(response.status, status);
    const body = await response.text();
    assert.doesNotMatch(body, /SQL|secret|private dept|invalid values/);
  }
});

test("binary exports stream unchanged with fixed download headers; client cancellation reaches upstream", async (t) => {
  let cancelled = false;
  const bytes = new Uint8Array([80, 75, 3, 4, 42]);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { headers: { "content-type": xlsx, "set-cookie": "token=secret", "content-disposition": 'inline; filename="evil.html"' } }));
  let response = await proxy(req("/police-events/export", "POST", {}));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="Report.xlsx"');
  assert.equal(response.headers.has("set-cookie"), false);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": xlsx } }));
  response = await proxy(req("/tags-v2/export", "POST", {}));
  await response.body.cancel();
  assert.equal(cancelled, true);
  t.mock.method(globalThis, "fetch", async () => ok({ not: "xlsx" }));
  assert.equal((await proxy(req("/tags-v2/export", "POST", {}))).status, 502);
});

test("abort and timeout cancel fetch and streamed exports", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const abort = new AbortController();
  const pending = proxy(req("/auth/me", "GET", undefined, {}, abort.signal));
  abort.abort();
  assert.equal((await pending).status, 499);
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn) => realTimeout(fn, 5));
  assert.equal((await proxy(req("/auth/me"))).status, 504);
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": xlsx } }));
  const response = await proxy(req("/tags-v2/export", "POST", {}));
  await assert.rejects(response.arrayBuffer(), /interrupted/);
  assert.equal(cancelled, true);
});

test("bounded parser cancels stalled and oversized streams, rejects malformed UTF-8", async () => {
  let cancelled = false;
  const abort = new AbortController();
  const stalled = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = readBoundedJson(stalled, 10, abort.signal);
  abort.abort();
  await assert.rejects(pending);
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedJson(new Response("123456").body, 5, new AbortController().signal), (e) => e.status === 413);
  await assert.rejects(readBoundedJson(new Response(new Uint8Array([0xff])).body, 10, new AbortController().signal), (e) => e.status === 400);
});
