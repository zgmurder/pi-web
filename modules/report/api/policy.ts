/** Explicit route/method policy, not a general reverse proxy. */
const READ_PATHS = new Set([
  "/auth/me",
  "/departments/tree", "/departments/subordinates",
  "/components/feedback-category-tree",
  "/report-search/options", "/report-search/dictionary-config", "/report-search/classifications",
  "/report-search/classification-tree", "/report-search/metrics",
  "/police-events/community-options", "/police-events/street-options", "/police-events/tag-options",
  "/police-events/110-stats/category-options", "/police-events/110-stats/feedback-category-options",
  "/police-events/110-stats/place-options",
  "/warnings/rules", "/warnings/options", "/warnings/list", "/warnings/recent",
  "/tags/packages",
  "/tags-v2/catalog", "/tags-v2/stats", "/tags-v2/search",
]);
const POST_PATHS = new Set([
  "/police-events/search", "/police-events/110-stats", "/tags/packages",
]);
const EXPORT_PATHS = new Set([
  "/police-events/export", "/police-events/110-stats/export", "/tags-v2/export",
]);

export function isBusinessRouteAllowed(method: string, path: string): boolean {
  // Reject normalization ambiguities, including encoded slashes/dots and extra segments.
  if (path.length > 256 || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) return false;
  if (method === "GET") return READ_PATHS.has(path)
    || (/^\/tags-v2\/alarms\/[A-Za-z0-9_-]{1,128}$/.test(path) && path !== "/tags-v2/alarms/verify");
  if (method === "POST") return POST_PATHS.has(path) || EXPORT_PATHS.has(path);
  if (method === "PUT") return path === "/tags-v2/alarms/verify" || /^\/tags\/packages\/[1-9][0-9]{0,18}$/.test(path);
  if (method === "DELETE") return /^\/tags\/packages\/[1-9][0-9]{0,18}$/.test(path);
  return false;
}

export function businessPathFromSegments(segments: string[]): string | null {
  if (!Array.isArray(segments) || !segments.length
    || segments.some((segment) => typeof segment !== "string" || !/^[A-Za-z0-9_-]+$/.test(segment))) return null;
  const path = `/${segments.join("/")}`;
  return path.length <= 256 ? path : null;
}

export function reportApiOrigin(config = process.env.REPORT_API_URL || "http://127.0.0.1:8001"): URL {
  // Configuration is operator-controlled, never taken from request headers/query/body.
  // Validate before URL parsing so its normalization cannot hide a path or backslash.
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/.test(config)) throw new Error("Invalid Report origin");
  const url = new URL(config);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
    || url.pathname !== "/" || url.hash || url.search) throw new Error("Invalid Report origin");
  return url;
}

export function businessUpstreamUrl(path: string, search: string, origin: URL): URL {
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) throw new Error("Invalid path");
  if (search.length > 65536 || (search && !search.startsWith("?")) || /[#\r\n\u0000]/.test(search)) throw new Error("Invalid query");
  const url = new URL(`/api/v1${path}`, origin);
  url.search = search;
  return url;
}

export function isReportToken(token: unknown): token is string {
  return typeof token === "string" && token.length <= 3500 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

export function businessRoutePolicy(method: string, path: string): { binary: boolean; timeout: number } | null {
  if (!isBusinessRouteAllowed(method, path)) return null;
  const binary = method === "POST" && EXPORT_PATHS.has(path);
  return { binary, timeout: binary || path === "/tags-v2/search" ? 120000 : 30000 };
}
