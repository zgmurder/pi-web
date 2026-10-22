import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { businessPathFromSegments, businessRoutePolicy, businessUpstreamUrl, isReportToken, reportApiOrigin } from "./policy";

export const MAX_BUSINESS_BODY_BYTES = 2 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 32 * 1024 * 1024;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const RESPONSE_HEADERS = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };

class ProxyFailure extends Error {
  readonly status: number;
  constructor(status: number) { super("Report request failed"); this.status = status; }
}

function errorResponse(status: number): Response {
  const messages: Record<number, string> = {
    400: "请求参数无效，请检查筛选条件", 401: "未登录或登录已过期，请重新登录",
    403: "无权访问此数据或执行此操作", 404: "请求的数据或接口不存在",
    409: "数据状态冲突，请刷新后重试", 413: "请求数据过大，请减少选择项",
    415: "请求类型必须为 application/json", 422: "请求参数不符合要求，请检查输入",
    429: "请求过于频繁，请稍后重试", 499: "请求已取消",
    502: "业务服务返回异常，请稍后重试", 503: "业务服务暂不可用，请稍后重试",
    504: "请求超时，请缩小查询范围后重试",
  };
  return Response.json({ code: status, message: messages[status] || messages[502], data: null }, {
    status, headers: RESPONSE_HEADERS,
  });
}

/** Read incrementally, even without Content-Length; cancellation also bounds stalled bodies. */
export async function readBoundedJson(stream: ReadableStream<Uint8Array> | null, maxBytes: number, signal: AbortSignal,
  overflowStatus = 413): Promise<unknown> {
  if (!stream) throw new ProxyFailure(400);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maxBytes) throw new ProxyFailure(overflowStatus);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new ProxyFailure(overflowStatus === 502 ? 502 : 400); }
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Server-only transport: only the HttpOnly session cookie's token is forwarded. */
export async function proxyReportBusiness(request: Request, segments: string[], token: string | undefined): Promise<Response> {
  if (!isApiRequestAllowed(request)) return errorResponse(403);
  const path = businessPathFromSegments(segments);
  const policy = path && businessRoutePolicy(request.method, path);
  if (!path || !policy) return errorResponse(404);
  if (!isReportToken(token)) return errorResponse(401);
  let upstreamUrl: URL;
  try {
    const incoming = new URL(request.url);
    if (incoming.search.length > 65536) return errorResponse(400);
    upstreamUrl = businessUpstreamUrl(path, incoming.search, reportApiOrigin());
  } catch { return errorResponse(503); }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, policy.timeout);
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); };
  let streaming = false;
  try {
    controller.signal.throwIfAborted();
    let body: string | undefined;
    if (request.method === "POST" || request.method === "PUT") {
      if (!hasJsonContentType(request)) throw new ProxyFailure(415);
      if (request.headers.has("content-encoding")) throw new ProxyFailure(415);
      const length = request.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BUSINESS_BODY_BYTES)) throw new ProxyFailure(413);
      const data = await readBoundedJson(request.body, MAX_BUSINESS_BODY_BYTES, controller.signal);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new ProxyFailure(400);
      body = JSON.stringify(data);
    } else if (request.body) {
      throw new ProxyFailure(400);
    }
    const upstream = await fetch(upstreamUrl, {
      method: request.method, cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: policy.binary ? XLSX : "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body }),
    });
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      // Never relay SQL, traceback, credentials, request input, or arbitrary error messages.
      const status = [400, 401, 403, 404, 409, 413, 415, 422, 429].includes(upstream.status) ? upstream.status : 502;
      return errorResponse(status);
    }
    const mediaType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (policy.binary) {
      if (mediaType !== XLSX || !upstream.body) {
        void upstream.body?.cancel().catch(() => {});
        throw new ProxyFailure(502);
      }
      const reader = upstream.body.getReader();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        controller.signal.removeEventListener("abort", cancelStream);
      };
      let output: ReadableStreamDefaultController<Uint8Array>;
      const cancelStream = () => {
        if (finished) return;
        finish();
        void reader.cancel().catch(() => {});
        output.error(new Error("Report download interrupted"));
      };
      const stream = new ReadableStream<Uint8Array>({
        start(target) {
          output = target;
          controller.signal.addEventListener("abort", cancelStream, { once: true });
          if (controller.signal.aborted) cancelStream();
        },
        async pull(target) {
          try {
            const { done, value } = await reader.read();
            if (finished) return;
            if (done) { finish(); target.close(); }
            else target.enqueue(value);
          } catch {
            if (!finished) { finish(); target.error(new Error("Report download interrupted")); }
          }
        },
        cancel() { finish(); controller.abort(); return reader.cancel().catch(() => {}); },
      });
      streaming = true;
      return new Response(stream, { headers: { ...RESPONSE_HEADERS, "Content-Type": XLSX,
        "Content-Disposition": 'attachment; filename="Report.xlsx"' } });
    }
    if (mediaType !== "application/json") {
      void upstream.body?.cancel().catch(() => {});
      throw new ProxyFailure(502);
    }
    const payload = await readBoundedJson(upstream.body, MAX_JSON_RESPONSE_BYTES, controller.signal, 502);
    if (!payload || typeof payload !== "object" || !("code" in payload) || !("data" in payload)
      || typeof payload.code !== "number") throw new ProxyFailure(502);
    if (payload.code !== 0) return errorResponse(400);
    // A fixed success message avoids accidentally surfacing diagnostics from the backend.
    return Response.json({ code: 0, message: "ok", data: payload.data }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (timedOut) return errorResponse(504);
    if (request.signal.aborted) return errorResponse(499);
    return errorResponse(error instanceof ProxyFailure ? error.status : 503);
  } finally {
    if (!streaming) cleanup();
  }
}
