import { NextResponse, type NextRequest } from "next/server";
import { getAuthRetryAfterMs, recordAuthFailure, recordAuthSuccess, retryAfterSeconds } from "@/lib/auth-throttle";
import { hasJsonContentType, isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";

import { DEVICE_PATHS, isDeviceRequestAllowed } from "@/modules/report/browser/device-security";

export const REPORT_SESSION_COOKIE = "report_access_token";
const NO_STORE = { "Cache-Control": "no-store" };
// Not a JWT: demo sessions must never be forwarded as real Report credentials.
const DEMO_SESSION = "local-demo";

class ReportAuthError extends Error {
  constructor(public status: number, message: string, public retryAfter?: string) {
    super(message);
  }
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && token.length <= 3500 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

async function reportRequest(path: "login" | "me", init: RequestInit) {
  let response: Response;
  try {
    const base = new URL(process.env.REPORT_API_URL || "http://127.0.0.1:8001");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
      throw new Error("Report 后端地址配置无效");
    }
    response = await fetch(new URL(`/api/v1/auth/${path}`, base), {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ReportAuthError(503, "Report 登录服务暂不可用，请稍后重试。");
  }
  if (response.status === 401 || response.status === 403) throw new ReportAuthError(401, "用户名或密码错误，或登录已过期");
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    throw new ReportAuthError(429, "登录尝试过于频繁，请稍后重试。", retry && /^\d{1,6}$/.test(retry) ? retry : undefined);
  }
  if (!response.ok) throw new ReportAuthError(503, "Report 登录服务暂不可用，请稍后重试。");
  const payload = await response.json().catch(() => null);
  if (payload?.code !== 0 || !payload.data || typeof payload.data !== "object") {
    throw new ReportAuthError(502, "Report 登录服务返回异常，请稍后重试。");
  }
  return payload.data;
}

async function currentUser(request: NextRequest) {
  const token = request.cookies.get(REPORT_SESSION_COOKIE)?.value;
  if (process.env.REPORT_DEMO_LOGIN === "true") {
    return token === DEMO_SESSION ? { id: 1, username: "演示用户" } : null;
  }
  if (!validToken(token)) return null;
  try {
    // shortcut: validate each request remotely; profile /auth/me load before adding a bounded cache.
    const user = await reportRequest("me", { headers: { Authorization: `Bearer ${token}` } });
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.username !== "string" || !user.username) {
      throw new ReportAuthError(502, "Report 登录服务返回异常，请稍后重试。");
    }
    return { id: user.id as number, username: user.username as string };
  } catch (error) {
    if (error instanceof ReportAuthError && error.status === 401) return null;
    throw error;
  }
}

function authError(error: unknown) {
  const failure = error instanceof ReportAuthError ? error : new ReportAuthError(503, "Report 登录服务暂不可用，请稍后重试。");
  return NextResponse.json({ error: failure.message }, {
    status: failure.status,
    headers: { ...NO_STORE, ...(failure.retryAfter ? { "Retry-After": failure.retryAfter } : {}) },
  });
}

function setSessionCookie(response: NextResponse, request: Request, token: string) {
  response.cookies.set({
    name: REPORT_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:"
      || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https",
    path: "/",
    ...(token ? {} : { maxAge: 0 }),
  });
}

export async function authStatus(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return authError(new ReportAuthError(403, "不可信的请求来源"));
  try {
    const user = await currentUser(request);
    const response = NextResponse.json({ enabled: true, authenticated: Boolean(user), user }, { headers: NO_STORE });
    if (!user) setSessionCookie(response, request, "");
    return response;
  } catch (error) {
    return authError(error);
  }
}

export async function login(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return authError(new ReportAuthError(403, "不可信的请求来源"));
  if (!hasJsonContentType(request)) return authError(new ReportAuthError(415, "请求类型必须为 application/json"));
  const retryAfterMs = getAuthRetryAfterMs();
  if (retryAfterMs > 0) return authError(new ReportAuthError(429, "登录尝试过于频繁，请稍后重试。", String(retryAfterSeconds(retryAfterMs))));
  const body = await request.json().catch(() => null);
  if (!body || typeof body.username !== "string" || !body.username.trim() || [...body.username].length > 80
    || typeof body.password !== "string" || !body.password || [...body.password].length > 128) {
    return authError(new ReportAuthError(400, "请输入用户名和密码，长度分别不得超过 80 和 128 个字符"));
  }
  if (process.env.REPORT_DEMO_LOGIN === "true") {
    recordAuthSuccess();
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    setSessionCookie(response, request, DEMO_SESSION);
    return response;
  }
  try {
    const data = await reportRequest("login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: body.username.trim(), password: body.password }),
    });
    if (!validToken(data.access_token) || data.token_type !== "bearer") {
      throw new ReportAuthError(502, "Report 登录服务返回异常，请稍后重试。");
    }
    recordAuthSuccess();
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    setSessionCookie(response, request, data.access_token);
    return response;
  } catch (error) {
    if (error instanceof ReportAuthError && error.status === 401) {
      error.retryAfter = String(retryAfterSeconds(recordAuthFailure()));
    }
    return authError(error);
  }
}

export async function logout(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return authError(new ReportAuthError(403, "不可信的请求来源"));
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  setSessionCookie(response, request, "");
  return response;
}

export async function protectRequest(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // These exact connector routes authenticate their independent device token / one-time pairing capability.
  if (DEVICE_PATHS.has(path)) return isDeviceRequestAllowed(request)
    ? NextResponse.next() : authError(new ReportAuthError(403, "不可信的扩展来源"));
  const isApi = path === "/api" || path.startsWith("/api/");
  if (!(isApi ? isApiRequestAllowed(request) : isApiRequestHostAllowed(request))) {
    return authError(new ReportAuthError(403, "不可信的请求来源"));
  }
  if (path === "/login" || path === "/api/web-auth") return NextResponse.next();
  try {
    if (await currentUser(request)) return NextResponse.next();
  } catch (error) {
    return authError(error);
  }
  let response: NextResponse;
  if (isApi) {
    response = authError(new ReportAuthError(401, "未登录或登录已过期"));
  } else {
    const destination = new URL("/login", request.url);
    destination.searchParams.set("next", `${path}${request.nextUrl.search}`);
    response = NextResponse.redirect(destination);
    response.headers.set("Cache-Control", "no-store");
  }
  setSessionCookie(response, request, "");
  return response;
}
