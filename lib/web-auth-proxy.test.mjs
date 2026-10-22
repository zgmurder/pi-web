import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { proxy, config } = await jiti.import("../proxy.ts");
const originalFetch = globalThis.fetch;
let calls;
let upstream;
beforeEach(() => {
  calls = 0;
  upstream = () => Response.json({ code: 0, data: { id: 1, username: "operator", roles: ["user"] } });
  globalThis.fetch = async () => { calls++; return upstream(); };
});
after(() => { globalThis.fetch = originalFetch; });
const cookie = { Cookie: "report_access_token=test.payload.signature" };
function request(path, headers = {}) {
  return new NextRequest(`http://localhost${path}`, { headers: { Host: "localhost", ...headers } });
}

test("protects chat and all business routes, preserving paths and queries", async () => {
  assert.ok(config.matcher.includes("/report/:path*"));
  for (const path of ["/", "/?session=abc", "/report/analysis", "/report/warnings", "/report/tagging", "/report/police", "/report/police-stats", "/report/dashboard", "/report/police?q=test"]) {
    const response = await proxy(request(path));
    const target = new URL(response.headers.get("location"));
    assert.equal(response.status, 307);
    assert.equal(target.pathname, "/login");
    assert.equal(target.searchParams.get("next"), path);
    assert.equal((await proxy(request(path, cookie))).headers.get("x-middleware-next"), "1");
  }
});

test("all API categories require Report identity, including files, terminals and events", async () => {
  for (const path of ["/api/sessions", "/api/files/test", "/api/terminal", "/api/agent/new", "/api/agent/abc/events", "/api/models", "/api/tools/settings"]) {
    assert.equal((await proxy(request(path))).status, 401);
    assert.equal((await proxy(request(path, cookie))).status, 200);
  }
});

test("only exact device endpoints bypass Report identity, never origin/host guards", async () => {
  const origin = `chrome-extension://${"a".repeat(32)}`;
  for (const path of ["/api/chrome-gateway/pair/claim", "/api/chrome-gateway/device/next", "/api/chrome-gateway/device/result"]) {
    assert.equal((await proxy(request(path, { Origin: origin }))).headers.get("x-middleware-next"), "1");
    assert.equal((await proxy(request(path, { Origin: origin, "Sec-Fetch-Site": "cross-site" }))).status, 200);
    assert.equal((await proxy(request(path, { Origin: "http://localhost" }))).status, 403);
    assert.equal((await proxy(request(path, { Origin: origin, Host: "evil.example" }))).status, 403);
    assert.equal((await proxy(request(path, { "Sec-Fetch-Site": "same-origin" }))).status, 403);
    assert.equal((await proxy(request(path, { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "cors" }))).status, 200);
    assert.equal((await proxy(request(path, { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate" }))).status, 403);
  }
  for (const path of ["/api/chrome-gateway/device", "/api/chrome-gateway/device/next/extra", "/api/chrome-gateway/internal/pair", "/api/report/browser"]) {
    assert.equal((await proxy(request(path))).status, 401);
  }
  assert.equal(calls, 0);
  assert.ok(config.matcher.includes("/report-chrome-connector.zip"));
  assert.equal((await proxy(request("/report-chrome-connector.zip"))).status, 307);
});

test("old signed cookies and Basic auth cannot bypass Report login", async () => {
  for (const headers of [{ Cookie: "pi_web_session=v1.old.session" }, { Authorization: `Basic ${Buffer.from("pi:secret").toString("base64")}` }, { Authorization: "Bearer test.payload.signature" }]) {
    assert.equal((await proxy(request("/api/sessions", headers))).status, 401);
  }
  assert.equal(calls, 0);
});

test("login and logout endpoints remain available without Report service", async () => {
  upstream = () => { throw new Error("offline"); };
  assert.equal((await proxy(request("/login", cookie))).status, 200);
  assert.equal((await proxy(request("/api/web-auth", cookie))).status, 200);
  assert.equal(calls, 0);
});

test("expired/disabled users are rejected and cookies cleared", async () => {
  upstream = () => new Response(null, { status: 401 });
  const response = await proxy(request("/api/sessions", cookie));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await proxy(request("/", cookie))).status, 307);
});

test("Report outage fails closed without deleting the session or leaking internal errors", async () => {
  upstream = () => { throw new Error("private details"); };
  const response = await proxy(request("/api/sessions", cookie));
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.doesNotMatch(await response.text(), /private details/);
});

test("rejects cross-site and untrusted-host requests before contacting Report", async () => {
  assert.equal((await proxy(request("/api/sessions", { ...cookie, Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await proxy(request("/", { ...cookie, Host: "evil.example" }))).status, 403);
  assert.equal(calls, 0);
});
