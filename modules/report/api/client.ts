/** Report business API. Credentials stay in the same-origin HttpOnly cookie. */
export interface RequestConfig { signal?: AbortSignal; timeout?: number }

export class ReportApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ReportApiError";
    this.status = status;
  }
}

export function businessUrl(path: string, params?: Record<string, unknown>): string {
  const [pathname, query = "", ...extra] = path.split("?");
  if (!pathname.startsWith("/") || pathname.startsWith("//") || extra.length || path.includes("#")
    || pathname.slice(1).split("/").some((part) => {
      try { return !/^[A-Za-z0-9_-]+$/.test(decodeURIComponent(part)); } catch { return true; }
    })) throw new ReportApiError("无效的业务接口路径");
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    search.delete(key);
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) search.append(key, String(item));
    }
  }
  const suffix = search.toString();
  return `/api/report/business${pathname}${suffix ? `?${suffix}` : ""}`;
}

export function loginDestination(pathname: string, search = "", hash = ""): string {
  const next = pathname.startsWith("/") && !pathname.startsWith("//") && !/[\\\r\n]/.test(pathname + search + hash)
    ? pathname + search + hash : "/report";
  return `/login?next=${encodeURIComponent(next)}`;
}

function redirectToLogin() {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign(loginDestination(window.location.pathname, window.location.search, window.location.hash));
  }
}

function fallbackMessage(status: number): string {
  if (status === 401) return "未登录或登录已过期，请重新登录";
  if (status === 403) return "无权访问此数据或执行此操作";
  if (status === 429) return "请求过于频繁，请稍后重试";
  if (status === 504) return "请求超时，请稍后重试";
  return "请求失败，请稍后重试";
}

async function checkResponse(response: Response) {
  if (response.status === 401) redirectToLogin();
  if (!response.ok) {
    // The proxy supplies safe messages; never display arbitrary upstream HTML/errors.
    const payload = await response.json().catch(() => null);
    const message = typeof payload?.message === "string" && payload.message.length <= 300
      ? payload.message : fallbackMessage(response.status);
    throw new ReportApiError(message, response.status);
  }
}

async function request<T>(path: string, method: string, data?: unknown, config?: RequestConfig,
  params?: Record<string, unknown>, binary = false): Promise<T> {
  const url = businessUrl(path, params);
  const controller = new AbortController();
  const cancel = () => controller.abort(config?.signal?.reason);
  const timeout = config?.timeout ?? 30000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120000) throw new ReportApiError("请求超时设置无效");
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  config?.signal?.addEventListener("abort", cancel, { once: true });
  if (config?.signal?.aborted) cancel();
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, {
      method, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { Accept: binary ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json",
        ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: controller.signal,
    });
    await checkResponse(response);
    if (binary) {
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
        throw new ReportApiError("导出服务返回异常", 502);
      }
      return { blob: await response.blob(), disposition: response.headers.get("content-disposition") } as T;
    }
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload.code !== "number" || !("data" in payload)) throw new ReportApiError("业务服务返回异常", 502);
    if (payload.code !== 0) throw new ReportApiError(typeof payload.message === "string" && payload.message.length <= 300
      ? payload.message : "请求失败", response.status);
    return payload.data as T;
  } catch (error) {
    if (timedOut) throw new ReportApiError("请求超时，请稍后重试", 504);
    if (controller.signal.aborted) throw config?.signal?.reason ?? new DOMException("请求已取消", "AbortError");
    if (error instanceof ReportApiError) throw error;
    throw new ReportApiError("无法连接业务服务，请检查网络后重试");
  } finally {
    clearTimeout(timer);
    config?.signal?.removeEventListener("abort", cancel);
  }
}

export function apiGet<T>(path: string, params?: Record<string, unknown>, config?: RequestConfig): Promise<T> {
  return request<T>(path, "GET", undefined, config, params);
}
export function apiPost<T>(path: string, data?: unknown, config?: RequestConfig): Promise<T> {
  return request<T>(path, "POST", data, config);
}
export function apiPut<T>(path: string, data?: unknown): Promise<T> { return request<T>(path, "PUT", data); }
export function apiDelete<T>(path: string): Promise<T> { return request<T>(path, "DELETE"); }

export function safeDownloadFilename(filename: string): string {
  const clean = filename.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g, "_")
    .replace(/^\.+/, "").trim().slice(0, 160).replace(/[. ]+$/, "");
  // All approved export endpoints produce XLSX, never executable or HTML downloads.
  return `${clean.replace(/\.xlsx$/i, "") || "Report"}.xlsx`;
}

export async function downloadReport(path: string, data: unknown, filename: string): Promise<void> {
  const { blob } = await request<{ blob: Blob; disposition: string | null }>(path, "POST", data, { timeout: 120000 }, undefined, true);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = safeDownloadFilename(filename);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Allow the browser to consume the URL before releasing it (including Safari).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
