import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { GET, POST, DELETE } = await jiti.import("./route.ts");
const { recordAuthSuccess } = await import("../../../lib/auth-throttle.ts");
const originalFetch = globalThis.fetch;
const originalUrl = process.env.REPORT_API_URL;
const token = "test.payload.signature";
const calls = [];
let upstream;
beforeEach(() => {
  recordAuthSuccess();
  process.env.REPORT_API_URL = "http://127.0.0.1:8001";
  calls.length = 0;
  upstream = () => Response.json({ code: 0, data: { access_token: token, token_type: "bearer" } });
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return upstream(); };
});
after(() => {
  recordAuthSuccess();
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.REPORT_API_URL;
  else process.env.REPORT_API_URL = originalUrl;
});
function request(method, body, headers = {}, url = "http://localhost/api/web-auth") {
  return new NextRequest(url, { method, headers: {
    Host: "localhost", Origin: new URL(url).origin, "Sec-Fetch-Site": "same-origin",
    ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const credentials = { username: " operator ", password: "not-a-real-password" };

test("forwards JSON credentials to Report; only an HttpOnly session cookie carries the token", async () => {
  const response = await POST(request("POST", credentials));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^report_access_token=test.payload.signature;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Max-Age=/);
  assert.equal(calls[0].url, "http://127.0.0.1:8001/api/v1/auth/login");
  assert.deepEqual(JSON.parse(calls[0].init.body), { ...credentials, username: "operator" });
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
  upstream = () => Response.json({ code: 0, data: { id: 7, username: "operator", roles: ["user"] } });
  const status = await GET(request("GET", undefined, { Cookie: cookie.split(";", 1)[0] }));
  assert.deepEqual(await status.json(), { enabled: true, authenticated: true, user: { id: 7, username: "operator" } });
  assert.equal(calls[1].url, "http://127.0.0.1:8001/api/v1/auth/me");
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${token}`);
});

test("sets Secure for HTTPS and trusted HTTPS proxy deployments", async () => {
  for (const [url, headers] of [["https://localhost/api/web-auth", {}], ["http://localhost/api/web-auth", { "x-forwarded-proto": "https" }]]) {
    const response = await POST(request("POST", credentials, headers, url));
    assert.match(response.headers.get("set-cookie"), /Secure/);
  }
});

test("validates credentials and content type without contacting Report", async () => {
  for (const body of [null, {}, { password: "x" }, { username: "  ", password: "x" }, { username: "a".repeat(81), password: "x" }, { username: "a", password: "x".repeat(129) }, { username: {}, password: "x" }]) {
    assert.equal((await POST(request("POST", body))).status, 400);
  }
  assert.equal((await POST(request("POST", credentials, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(calls.length, 0);
});

test("preserves 401 and throttles subsequent attempts; preserves upstream 429", async () => {
  upstream = () => Response.json({ detail: "wrong" }, { status: 401 });
  assert.equal((await POST(request("POST", credentials))).status, 401);
  assert.equal((await POST(request("POST", credentials))).status, 429);
  assert.equal(calls.length, 1);
  recordAuthSuccess();
  upstream = () => new Response(null, { status: 429, headers: { "Retry-After": "20" } });
  const response = await POST(request("POST", credentials));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "20");
});

test("expired/disabled sessions clear the cookie; failures never authenticate", async () => {
  for (const status of [401, 403]) {
    upstream = () => new Response(null, { status });
    const response = await GET(request("GET", undefined, { Cookie: `report_access_token=${token}` }));
    assert.equal((await response.json()).authenticated, false);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }
  upstream = () => { throw new Error("private network details"); };
  for (const response of [await GET(request("GET", undefined, { Cookie: `report_access_token=${token}` })), await POST(request("POST", credentials))]) {
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private network details/);
  }
});

test("rejects malformed backend payloads and oversized/cookie-unsafe tokens", async () => {
  for (const data of [null, {}, { access_token: "a.b.c;malicious", token_type: "bearer" }, { access_token: `${"a".repeat(3500)}.b.c`, token_type: "bearer" }]) {
    upstream = () => Response.json({ code: 0, data });
    const response = await POST(request("POST", credentials));
    assert.equal(response.status, 502);
    assert.equal(response.headers.has("set-cookie"), false);
  }
  upstream = () => Response.json({ code: 0, data: {} });
  assert.equal((await GET(request("GET", undefined, { Cookie: `report_access_token=${token}` }))).status, 502);
});

test("logout works even when Report is down, and anonymous status stays enabled", async () => {
  upstream = () => { throw new Error("offline"); };
  const response = await DELETE(request("DELETE"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /report_access_token=;.*Max-Age=0/);
  assert.equal((await (await GET(request("GET"))).json()).authenticated, false);
  assert.equal(calls.length, 0);
});

test("all auth methods reject cross-origin requests", async () => {
  const headers = { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" };
  assert.equal((await POST(request("POST", credentials, headers))).status, 403);
  assert.equal((await DELETE(request("DELETE", undefined, headers))).status, 403);
  assert.equal((await GET(request("GET", undefined, headers))).status, 403);
  assert.equal(calls.length, 0);
});

test("configured origin is server-only, invalid origins fail closed", async () => {
  process.env.REPORT_API_URL = "http://report.internal:8001";
  await POST(request("POST", credentials));
  assert.equal(calls[0].url, "http://report.internal:8001/api/v1/auth/login");
  process.env.REPORT_API_URL = "http://user:secret@report.internal";
  assert.equal((await POST(request("POST", credentials))).status, 503);
  assert.equal(calls.length, 1);
});
