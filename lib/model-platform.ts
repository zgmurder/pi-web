import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readRegularFileText } from "./regular-file";
import { serializeByKey } from "./key-serializer";

export class PlatformError extends Error {}
interface PlatformConfig { instance: string; enabled: boolean; apiUrl: string; webUrl: string; apiKey: string; authType?: "apiKey" | "bearer" }
const path = () => join(getAgentDir(), "pi-web-model-platform.json");
function url(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Invalid platform URL.");
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new PlatformError("平台地址无效，请填写 http://主机:端口，不含路径。"); }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new PlatformError("平台地址只允许 HTTP/HTTPS、主机和端口，请移除路径、用户名及查询参数。");
  return u.origin;
}
function parse(value: unknown): PlatformConfig {
  const v = value as PlatformConfig;
  if (!v || typeof v.enabled !== "boolean" || typeof v.instance !== "string" || !/^[a-f0-9-]{36}$/.test(v.instance)
    || typeof v.apiKey !== "string" || v.apiKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(v.apiKey)) throw new Error("Invalid platform configuration.");
  if (v.authType !== undefined && !["apiKey", "bearer"].includes(v.authType)) throw new PlatformError("请选择有效的授权方式。");
  return { instance: v.instance, enabled: v.enabled, apiUrl: url(v.apiUrl), webUrl: url(v.webUrl), apiKey: v.apiKey, authType: v.authType ?? "apiKey" };
}
export function platformConfig(): PlatformConfig | null {
  const value = readRegularFileText(path(), 16384);
  if (value === undefined) return null;
  try { return parse(JSON.parse(value)); } catch { throw new Error("Invalid platform configuration; file was not changed."); }
}
export function publicPlatformConfig() {
  const config = platformConfig();
  return config ? { enabled: config.enabled, apiUrl: config.apiUrl, webUrl: config.webUrl, authType: config.authType, hasApiKey: !!config.apiKey }
    : { enabled: false, apiUrl: "http://127.0.0.1:9300", webUrl: "http://127.0.0.1:5180", authType: "bearer", hasApiKey: false };
}
export function platformDraft(value: unknown): PlatformConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid platform configuration.");
  const v = value as Partial<PlatformConfig>;
  const previous = platformConfig();
  const apiUrl = url(v.apiUrl);
  const sameOrigin = previous?.apiUrl === apiUrl;
  // Never send the old credential to a newly entered origin.
  const authType = v.authType ?? previous?.authType ?? "bearer";
  const sameAuth = sameOrigin && authType === previous?.authType;
  const key = v.apiKey ?? (sameAuth ? previous.apiKey : "");
  const apiKey = typeof key === "string" && authType === "bearer" ? key.trim().replace(/^Bearer\s+/i, "") : key;
  return parse({ ...v, authType, apiUrl, instance: sameOrigin ? previous.instance : randomUUID(), apiKey });
}
export async function savePlatform(value: unknown) {
  return serializeByKey(Symbol.for("pi-web:model-platform"), path(), async () => {
    mkdirSync(getAgentDir(), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(path(), { realpath: false, retries: 3 });
    try { writePrivateFileAtomicSync(path(), JSON.stringify(platformDraft(value), null, 2) + "\n"); return publicPlatformConfig(); }
    finally { await release(); }
  });
}
export async function platformRequest(config: PlatformConfig, endpoint: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  try {
    const response = await fetch(`${config.apiUrl}/api/v1${endpoint}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", redirect: "error", signal: controller,
      headers: { ...(config.apiKey ? (config.authType === "bearer" ? { Authorization: `Bearer ${config.apiKey}` } : { "X-API-Key": config.apiKey }) : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new PlatformError("平台授权失败（401）：登录 Token 可能无效或已过期，请重新登录平台并更新 Token；确认授权方式选为登录 Token。");
      if (response.status === 403) throw new PlatformError("平台拒绝访问（403），请检查账号权限。");
      if (response.status === 404) throw new PlatformError("平台接口不存在（404），请确认填写的是后端地址，且后端已加载所需接口。");
      throw new PlatformError(`平台请求失败（HTTP ${response.status}），请检查后端服务。`);
    }
    if (!response.body) throw new Error();
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 1024 * 1024) throw new Error(); chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError(signal?.aborted ? "平台请求已取消。" : "平台无法连接、请求超时或响应格式不正确，请检查后端地址、网络和服务状态。");
  }
}
export async function platformSources(config = platformConfig(), signal?: AbortSignal) {
  if (!config?.enabled) return [];
  const result = await platformRequest(config, "/datasources", undefined, signal);
  if (!Array.isArray(result) || result.length > 1000) throw new Error("Invalid platform source list.");
  return result.filter(s => s?.source_type === "database" && (s.config?.db_type ?? "mysql") === "mysql").map(s => {
    if (!Number.isSafeInteger(s.id) || s.id < 1 || typeof s.name !== "string" || s.name.length > 128) throw new Error("Invalid platform source.");
    return { id: `platform:${config.instance}:${s.id}`, name: s.name, notes: typeof s.description === "string" ? s.description.slice(0, 12000) : "", origin: "platform" as const };
  });
}
export function selectedPlatform(id: string) {
  const config = platformConfig();
  const match = /^platform:([a-f0-9-]{36}):([1-9][0-9]*)$/.exec(id);
  if (!config?.enabled || !match || config.instance !== match[1] || !Number.isSafeInteger(Number(match[2]))) throw new Error("Platform source is unavailable. Select a source again.");
  return { config, sourceId: match[2] };
}
