import { isApiRequestHostAllowed } from "@/lib/request-security";

export const DEVICE_PATHS = new Set([
  "/api/chrome-gateway/pair/claim", "/api/chrome-gateway/device/next", "/api/chrome-gateway/device/result",
]);
export function isDeviceRequestAllowed(request: Request): boolean {
  if (!isApiRequestHostAllowed(request)) return false;
  const origin = request.headers.get("origin");
  // HTTP Chrome extension fetches can omit Fetch Metadata; authentication is still mandatory in the route.
  if (origin) return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  // Chrome's extension GET omits Origin and sends Sec-Fetch-Site: none.
  return !request.headers.has("sec-fetch-site") || (request.headers.get("sec-fetch-site") === "none" && request.headers.get("sec-fetch-mode") === "cors");
}
export function deviceHeaders(request: Request): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin" });
  const origin = request.headers.get("origin");
  if (origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, content-type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return headers;
}
