import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readRegularFileText } from "@/lib/regular-file";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { serializeByKey } from "@/lib/key-serializer";

export interface BusinessSystem {
  id: string; name: string; url: string; port: number; username: string; notes: string;
  usernameSelector: string; passwordSelector: string; submitSelector: string; hasPassword: boolean;
}
type StoredSystem = Omit<BusinessSystem, "hasPassword"> & { password: string };
export class SystemError extends Error {}
const path = () => join(getAgentDir(), "report-business-systems.json");
const publicSystem = ({ password, ...rest }: StoredSystem): BusinessSystem => ({ ...rest, hasPassword: Boolean(password) });

export function parseSystem(value: unknown, previous?: StoredSystem): StoredSystem {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SystemError("业务系统配置格式不正确。");
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number, required = false) => {
    const s = v[key] ?? "";
    if (typeof s !== "string" || s.length > max || (required && !s.trim()) || (key !== "notes" && /[\u0000-\u001f]/.test(s))) throw new SystemError("字段为空、过长或含非法字符。");
    return s;
  };
  const id = text("id", 64) || randomUUID();
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new SystemError("系统 ID 不正确。");
  let url: URL;
  try { url = new URL(text("url", 2048, true)); } catch { throw new SystemError("请输入完整的 HTTP 或 HTTPS 登录网址。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new SystemError("网址只支持 HTTP/HTTPS，不能包含账号密码。");
  if (!Number.isInteger(v.port) || Number(v.port) < 1 || Number(v.port) > 65535) throw new SystemError("浏览器端口必须为 1–65535。");
  const username = text("username", 128);
  const suppliedPassword = text("password", 4096);
  // Never forward a retained credential to a changed destination or account.
  const sameTarget = previous?.url === url.href && previous?.username === username && previous?.port === v.port;
  const password = v.clearPassword === true ? "" : suppliedPassword || (sameTarget ? previous?.password ?? "" : "");
  return { id, name: text("name", 80, true).trim(), url: url.href, port: Number(v.port), username, password,
    notes: text("notes", 4000), usernameSelector: text("usernameSelector", 500), passwordSelector: text("passwordSelector", 500), submitSelector: text("submitSelector", 500) };
}
function readSystems(): StoredSystem[] {
  try {
    const raw = readRegularFileText(path(), 1024 * 1024);
    if (raw === undefined) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length > 100) throw new Error();
    const systems = data.map(v => parseSystem(v));
    if (new Set(systems.map(s => s.id)).size !== systems.length) throw new Error();
    return systems;
  } catch { throw new SystemError("无法读取业务系统配置；请检查私有配置文件，原文件不会被覆盖。"); }
}
export const listSystems = () => readSystems().map(publicSystem);
export function getSystem(id: string) {
  const system = readSystems().find(s => s.id === id);
  if (!system) throw new SystemError("业务系统不存在，请刷新配置。");
  return system;
}
export async function changeSystem(action: "save" | "delete", value: unknown) {
  return serializeByKey(Symbol.for("report:systems"), path(), async () => {
    mkdirSync(getAgentDir(), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(path(), { realpath: false, retries: 3 });
    try {
      const systems = readSystems();
      if (action === "delete") {
        const index = systems.findIndex(s => s.id === value);
        if (index < 0) throw new SystemError("业务系统不存在。");
        systems.splice(index, 1);
      } else {
        const id = (value as { id?: unknown } | null)?.id;
        const index = systems.findIndex(s => s.id === id);
        if (id && index < 0) throw new SystemError("业务系统已删除，请刷新后重试。");
        const system = parseSystem(value, systems[index]);
        if (index < 0) systems.push(system); else systems[index] = system;
      }
      const json = JSON.stringify(systems, null, 2);
      if (systems.length > 100 || Buffer.byteLength(json) > 1024 * 1024) throw new SystemError("配置超出容量限制。");
      writePrivateFileAtomicSync(path(), json + "\n");
      return systems.map(publicSystem);
    } finally { await release(); }
  });
}
