import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ChromeGatewayError } from "./chrome-gateway";

export const CHROME_GATEWAY_MAX_BODY_BYTES = 256 * 1024;

export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() || undefined : undefined;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInternalToken(request: Request): void {
  const configured = process.env.PI_CHROME_GATEWAY_INTERNAL_TOKEN;
  const supplied = bearerToken(request);
  if (!configured) throw new ChromeGatewayError("gateway-disabled", "PI_CHROME_GATEWAY_INTERNAL_TOKEN is not configured", 503);
  if (!supplied || !safeEqual(supplied, configured)) throw new ChromeGatewayError("internal-auth-invalid", "Internal gateway token is invalid", 401);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > CHROME_GATEWAY_MAX_BODY_BYTES) {
    throw new ChromeGatewayError("request-too-large", "Request body is too large", 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > CHROME_GATEWAY_MAX_BODY_BYTES) {
    throw new ChromeGatewayError("request-too-large", "Request body is too large", 413);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ChromeGatewayError("invalid-json", "Request body must be valid JSON", 400);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChromeGatewayError("invalid-json", "Request body must be a JSON object", 400);
  }
  return value as Record<string, unknown>;
}

function chromeExtensionCorsHeaders(request?: Request): Record<string, string> | undefined {
  const origin = request?.headers.get("origin");
  if (!origin?.startsWith("chrome-extension://")) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function chromeGatewayPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: chromeExtensionCorsHeaders(request) });
}

export function jsonError(error: unknown, request?: Request): NextResponse {
  const known = error instanceof ChromeGatewayError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "internal-error";
  const message = known ? error.message : "Chrome gateway request failed";
  if (!known) console.error("[pi-web] Chrome gateway request failed", error);
  return NextResponse.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store", ...chromeExtensionCorsHeaders(request) } });
}

export function noStoreJson(value: unknown, init?: ResponseInit, request?: Request): NextResponse {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(chromeExtensionCorsHeaders(request) ?? {})) headers.set(name, value);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(value, { ...init, headers });
}
