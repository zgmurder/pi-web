import assert from "node:assert/strict";
import test from "node:test";
import { businessPathFromSegments, businessRoutePolicy, businessUpstreamUrl, isBusinessRouteAllowed, isReportToken, reportApiOrigin } from "./policy.ts";

const routes = {
  GET: ["/auth/me", "/departments/tree", "/departments/subordinates", "/components/feedback-category-tree",
    "/report-search/options", "/report-search/dictionary-config", "/report-search/classifications", "/report-search/classification-tree", "/report-search/metrics",
    "/police-events/community-options", "/police-events/street-options", "/police-events/tag-options",
    "/police-events/110-stats/category-options", "/police-events/110-stats/feedback-category-options", "/police-events/110-stats/place-options",
    "/warnings/rules", "/warnings/options", "/warnings/list", "/warnings/recent", "/tags/packages",
    "/tags-v2/catalog", "/tags-v2/stats", "/tags-v2/search", "/tags-v2/alarms/FK2026_123-1"],
  POST: ["/police-events/search", "/police-events/110-stats", "/police-events/export", "/police-events/110-stats/export", "/tags/packages", "/tags-v2/export"],
  PUT: ["/tags/packages/123", "/tags-v2/alarms/verify"],
  DELETE: ["/tags/packages/123"],
};
test("exact endpoint and method allowlist covers the port without enabling administrative APIs", () => {
  for (const [method, paths] of Object.entries(routes)) {
    for (const path of paths) {
      assert.equal(isBusinessRouteAllowed(method, path), true, `${method} ${path}`);
      for (const candidate of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
        const expected = routes[candidate]?.includes(path) || false;
        assert.equal(isBusinessRouteAllowed(candidate, path), expected, `${candidate} ${path}`);
      }
    }
  }
  for (const path of ["/auth/login", "/users", "/departments", "/reports", "/pi-agent/chat", "/tags/catalog", "/police-events/query", "/report-search/query"]) {
    for (const method of Object.keys(routes)) assert.equal(isBusinessRouteAllowed(method, path), false, `${method} ${path}`);
  }
});

test("traversal, encoding, identifier and route-prefix ambiguities fail closed", () => {
  for (const path of ["//auth/me", "/auth/me/", "/auth/me?x=y", "/auth/me#x", "/auth/me%00", "/auth/me/../login",
    "/auth/%6de", "/tags-v2/alarms/%2f", "/tags-v2/alarms/%252e%252e", "/tags-v2/alarms/..", "/tags-v2/alarms/a\\b",
    "/tags-v2/alarms/a/b", "/tags-v2/alarms/verify", "/tags-v2/alarms/" + "a".repeat(129), "/tags/packages/0",
    "/tags/packages/-1", "/tags/packages/1e3", "/tags/packages/01", "/tags/packages/1/extra", "https://evil.test/auth/me"]) {
    assert.equal(isBusinessRouteAllowed("GET", path), false, path);
    assert.equal(isBusinessRouteAllowed("DELETE", path), false, path);
  }
  for (const parts of [[], ["auth", "../me"], ["auth", "%6de"], ["auth", "me?x"], ["auth", "me\0"], ["auth", "me", ""]]) {
    assert.equal(businessPathFromSegments(parts), null);
  }
  assert.equal(businessPathFromSegments(["auth", "me"]), "/auth/me");
});

test("fixed backend origin validation rejects path, credentials, fragments and URL normalization tricks", () => {
  for (const origin of ["file:///etc/passwd", "ftp://backend", "https://u:p@backend", "http://backend/api", "http://backend/..",
    "http://backend?url=evil", "http://backend#x", "http://backend\\@evil", " http://backend", "http://backend/", "https://[::1]:8001"]) {
    if (["http://backend/", "https://[::1]:8001"].includes(origin)) assert.doesNotThrow(() => reportApiOrigin(origin));
    else assert.throws(() => reportApiOrigin(origin), undefined, origin);
  }
  const origin = reportApiOrigin("http://127.0.0.1:8001");
  const url = businessUpstreamUrl("/tags-v2/search", "?url=https://evil.test/&keyword=%E6%B5%8B%E8%AF%95", origin);
  assert.equal(url.origin, origin.origin);
  assert.equal(url.pathname, "/api/v1/tags-v2/search");
  assert.equal(url.searchParams.get("keyword"), "测试");
  assert.throws(() => businessUpstreamUrl("//evil", "", origin));
  assert.throws(() => businessUpstreamUrl("/auth/me", "?x=" + "a".repeat(65536), origin));
});

test("token format and timeout/export policy are bounded", () => {
  assert.equal(isReportToken("a.b.c"), true);
  for (const token of [undefined, "", "Bearer a.b.c", "a.b.c\n", "a".repeat(3500) + ".b.c", "a.b.c.d"]) assert.equal(isReportToken(token), false);
  assert.deepEqual(businessRoutePolicy("POST", "/tags-v2/export"), { binary: true, timeout: 120000 });
  assert.deepEqual(businessRoutePolicy("GET", "/tags-v2/search"), { binary: false, timeout: 120000 });
  assert.deepEqual(businessRoutePolicy("GET", "/auth/me"), { binary: false, timeout: 30000 });
  assert.equal(businessRoutePolicy("DELETE", "/auth/me"), null);
});
