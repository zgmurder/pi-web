import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { proxy, config } = await jiti.import("../proxy.ts");
const { createWebSessionToken } = await jiti.import("./web-auth.ts");
const { getAuthRetryAfterMs, recordAuthFailure, recordAuthSuccess } = await import("./auth-throttle.ts");

before(() => { process.env.PI_WEB_PASSWORD = "secret"; });
beforeEach(() => { recordAuthSuccess(); });
after(() => {
  recordAuthSuccess();
  if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalPassword;
});

function request(path, headers = {}) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { Host: "localhost", ...headers },
  });
}

test("redirects page navigation to the login page and preserves its query", () => {
  const response = proxy(request("/?session=abc"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2F%3Fsession%3Dabc");
});

test("accepts a signed session for pages", () => {
  const token = createWebSessionToken("secret");
  const response = proxy(request("/", { Cookie: `pi_web_session=${token}` }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("keeps Basic Auth compatibility for APIs but not pages", () => {
  const authorization = `Basic ${Buffer.from("pi:secret").toString("base64")}`;
  assert.equal(proxy(request("/api/sessions", { Authorization: authorization })).status, 200);
  assert.equal(proxy(request("/", { Authorization: authorization })).status, 307);
  assert.equal(proxy(request("/api/sessions")).status, 401);
});

test("leaves the login endpoint reachable without a session", () => {
  assert.equal(proxy(request("/login")).status, 200);
  assert.equal(proxy(request("/api/web-auth")).status, 200);
});

test("only exact device endpoints bypass web login, never host/origin guards", () => {
  const origin = `chrome-extension://${"a".repeat(32)}`;
  for (const path of ["/api/chrome-gateway/pair/claim", "/api/chrome-gateway/device/next", "/api/chrome-gateway/device/result"]) {
    assert.equal(proxy(request(path, { Origin: origin })).headers.get("x-middleware-next"), "1");
    assert.equal(proxy(request(path, { Origin: origin, "Sec-Fetch-Site": "cross-site" })).status, 200);
    assert.equal(proxy(request(path, { Origin: "http://localhost" })).status, 403);
    assert.equal(proxy(request(path, { Origin: origin, Host: "evil.example" })).status, 403);
    assert.equal(proxy(request(path, { "Sec-Fetch-Site": "same-origin" })).status, 403);
    assert.equal(proxy(request(path, { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "cors" })).status, 200);
    assert.equal(proxy(request(path, { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate" })).status, 403);
  }
  for (const path of ["/api/chrome-gateway/device", "/api/chrome-gateway/device/next/extra", "/api/chrome-gateway/internal/pair", "/api/local-browser"]) {
    assert.equal(proxy(request(path)).status, 401);
    assert.equal(proxy(request(path, { Origin: origin })).status, 403);
  }
  const cookie = { Cookie: `pi_web_session=${createWebSessionToken("secret")}` };
  assert.equal(proxy(request("/api/local-browser", cookie)).status, 200);
  assert.equal(proxy(request("/api/local-browser", { ...cookie, Origin: "https://evil.example" })).status, 403);
  assert.ok(config.matcher.includes("/report-chrome-connector.zip"));
  const download = proxy(request("/report-chrome-connector.zip"));
  assert.equal(download.status, 307);
  assert.equal(new URL(download.headers.get("location")).searchParams.get("next"), "/report-chrome-connector.zip");
  assert.equal(proxy(request("/report-chrome-connector.zip", cookie)).status, 200);
});

test("without PI_WEB_PASSWORD native pages work offline but request guards remain", () => {
  delete process.env.PI_WEB_PASSWORD;
  try {
    for (const path of ["/", "/api/sessions", "/api/local-browser", "/report-chrome-connector.zip"]) {
      assert.equal(proxy(request(path)).status, 200);
      assert.equal(proxy(request(path, { Host: "evil.example" })).status, 403);
    }
    assert.equal(proxy(request("/login")).status, 307);
    assert.equal(proxy(request("/api/local-browser", { Origin: "https://evil.example" })).status, 403);
    assert.equal(proxy(request("/api/chrome-gateway/device/next", { Origin: "http://localhost" })).status, 403);
  } finally { process.env.PI_WEB_PASSWORD = "secret"; }
});

function basic(password) {
  return `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
}

test("a wrong Basic password blocks further attempts, even with the right password", () => {
  assert.equal(proxy(request("/api/sessions", { Authorization: basic("guess") })).status, 401);
  assert.ok(getAuthRetryAfterMs() > 0);

  for (const path of ["/api/sessions", "/api/web-auth"]) {
    const response = proxy(request(path, { Authorization: basic("secret") }));
    assert.equal(response.status, 429, path);
    assert.equal(response.headers.get("retry-after"), "1");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("GET /api/web-auth cannot be used to check Basic passwords without the throttle", () => {
  assert.equal(proxy(request("/api/web-auth", { Authorization: basic("guess") })).status, 200);
  assert.ok(getAuthRetryAfterMs() > 0);
  assert.equal(proxy(request("/api/web-auth", { Authorization: basic("guess-2") })).status, 429);
});

test("a signed session keeps working while Basic attempts are blocked", () => {
  proxy(request("/api/sessions", { Authorization: basic("guess") }));
  const token = createWebSessionToken("secret");
  const response = proxy(request("/api/sessions", {
    Authorization: basic("guess"),
    Cookie: `pi_web_session=${token}`,
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("only Basic credentials count as password attempts", () => {
  assert.equal(proxy(request("/api/sessions", { Authorization: "Bearer token" })).status, 401);
  assert.equal(getAuthRetryAfterMs(), 0);
});

test("a Basic success does not reset earlier failures", () => {
  recordAuthFailure(Date.now() - 2_000);
  assert.equal(getAuthRetryAfterMs(), 0);
  assert.equal(proxy(request("/api/sessions", { Authorization: basic("secret") })).status, 200);

  assert.equal(proxy(request("/api/sessions", { Authorization: basic("guess") })).status, 401);
  // The second failure in a row doubles the block instead of starting over.
  assert.ok(getAuthRetryAfterMs() > 1_000);
});
