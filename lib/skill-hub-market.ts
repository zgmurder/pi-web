import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as yauzl from "yauzl";
import { safeMarketEntry } from "./remote-market";
import { installMarketSkillSource } from "./local-market";
import type { LocalMarketSkill } from "./api-types";

const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
type HubSkill = { skillCode: string; skillName: string; skillSummary?: string; releaseId: string; releaseVersion?: string; packageSha256?: string; packageSize?: number };

export function skillHubUrl(): URL | undefined {
  const value = process.env.PI_WEB_SKILL_HUB_BRIDGE_URL?.trim() || process.env.PI_WEB_SKILL_HUB_URL?.trim();
  if (!value) return;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("PI_WEB_SKILL_HUB_URL must be an HTTP(S) base URL without credentials, query or fragment");
  }
  url.pathname = url.pathname.replace(/\/$/, "") + "/";
  return url;
}

export function skillHubManaged(context?: HubRequest): boolean { return process.env.PI_WEB_SKILL_HUB_MANAGED === "1" || !!process.env.PI_WEB_SKILL_HUB_BRIDGE_URL?.trim() || !!context?.headers.has("x-workspace-skill-capability"); }
export function skillHubConfigured(context?: HubRequest): boolean { return skillHubManaged(context) || !!process.env.PI_WEB_SKILL_HUB_URL?.trim(); }
type HubRequest = Pick<Request, "headers" | "signal">;

async function request(resource: string, limit: number, context?: HubRequest): Promise<Buffer> {
  const managed = skillHubManaged(context);
  const capability = context?.headers.get("x-workspace-skill-capability");
  if (managed && (!process.env.PI_WEB_SKILL_HUB_BRIDGE_URL?.trim() || !capability || !/^[a-f0-9]{64}$/.test(capability))) {
    throw new Error("Skill Hub: 请登录平台并从平台重新打开个人工作空间；独立地址没有平台身份。管理员请检查技能桥接配置。");
  }
  const base = skillHubUrl();
  if (!base) throw new Error("Skill Hub is not configured");
  const token = managed ? undefined : process.env.PI_WEB_SKILL_HUB_TOKEN?.trim();
  if (!managed && !token) throw new Error("Skill Hub: 请从平台打开个人工作空间；仅独立实例可在服务器配置 PI_WEB_SKILL_HUB_TOKEN");
  let response: Response;
  try {
    response = await fetch(new URL(resource, base), {
      headers: managed ? { "x-workspace-skill-capability": capability! } : { Authorization: `Bearer ${token}` }, redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(context ? [context.signal] : [])]), cache: "no-store",
    });
  } catch { throw new Error("Skill Hub request failed or timed out"); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Skill Hub HTTP ${response.status}${response.status === 401 || response.status === 403 ? managed ? ": 请登录平台并重新打开个人工作空间，或检查当前技能权限" : ": Desktop token missing or expired" : ""}`);
  }
  if (!response.body) throw new Error("Empty Skill Hub response");
  const reader = response.body.getReader();
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Skill Hub response exceeds size limit");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
async function json(resource: string, context?: HubRequest) {
  const bytes = await request(resource, 8 * 1024 * 1024, context);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Invalid Skill Hub JSON response"); }
}
function validSkill(value: unknown): value is HubSkill {
  if (!value || typeof value !== "object") return false;
  const item = value as HubSkill;
  return typeof item.skillCode === "string" && ID.test(item.skillCode)
    && typeof item.releaseId === "string" && ID.test(item.releaseId)
    && typeof item.skillName === "string" && item.skillName.length > 0 && item.skillName.length <= 256
    && (item.skillSummary == null || typeof item.skillSummary === "string" && item.skillSummary.length <= 10000)
    && (item.releaseVersion == null || typeof item.releaseVersion === "string" && item.releaseVersion.length <= 128);
}
export async function readSkillHubMarket(context?: HubRequest): Promise<LocalMarketSkill[]> {
  const skills: LocalMarketSkill[] = [];
  const seen = new Set<string>();
  let count = 0;
  const managed = skillHubManaged(context);
  const pageSize = managed ? 30 : 100;
  for (let page = 1; page <= Math.ceil(10000 / pageSize); page++) {
    const result = await json(`desktop/skills?pageNo=${page}&pageSize=${pageSize}`, context);
    if (!result || !Array.isArray(result.records) || !result.records.every((item: unknown) =>
      managed && !!item && typeof item === "object" && (item as { installable?: boolean }).installable === false || validSkill(item))
      || !Number.isSafeInteger(result.total) || result.total < 0 || result.total > 10000) throw new Error("Invalid Skill Hub catalogue");
    count += result.records.length;
    for (const item of result.records as (HubSkill & { installable?: boolean })[]) {
      if (managed && item.installable !== true) continue;
      if (seen.has(item.skillCode)) throw new Error("Skill Hub catalogue changed; refresh and try again");
      seen.add(item.skillCode);
      skills.push({ id: `skillhub:${item.skillCode}`, name: item.skillCode, displayName: item.skillName,
        description: item.skillSummary ?? "", version: item.releaseVersion });
    }
    if (count >= result.total) return skills;
    if (!result.records.length) break;
  }
  throw new Error("Skill Hub catalogue is incomplete or exceeds size limit");
}

// Preflight all entries before writing; yauzl checks decoded names and expanded sizes.
export async function unpackSkillHubZip(bytes: Buffer, target: string): Promise<string> {
  if (bytes.length > MAX_ARCHIVE) throw new Error("Skill Hub archive too large");
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, autoClose: false }, (error, file) => error ? reject(error) : resolve(file!));
  });
  try {
    const entries = await new Promise<yauzl.Entry[]>((resolve, reject) => {
      const result: yauzl.Entry[] = []; const seen = new Set<string>(); let total = 0;
      zip.on("error", reject);
      zip.on("end", () => resolve(result));
      zip.on("entry", (entry: yauzl.Entry) => {
        const directory = entry.fileName.endsWith("/");
        const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        total += entry.uncompressedSize;
        if (!safeMarketEntry(name) || seen.has(name.toLowerCase()) || result.length >= 5000
          || total > MAX_EXPANDED || (entry.generalPurposeBitFlag & 1)
          || (mode !== 0 && mode !== (directory ? 0x4000 : 0x8000))) {
          reject(new Error("Skill Hub ZIP contains unsafe paths, links, duplicates or oversized files")); return;
        }
        seen.add(name.toLowerCase()); result.push(entry); zip.readEntry();
      });
      zip.readEntry();
    });
    const manifests = entries.filter(e => /(^|\/)SKILL\.md$/.test(e.fileName));
    if (manifests.length !== 1) throw new Error("Skill Hub ZIP must contain exactly one SKILL.md");
    const prefix = manifests[0].fileName.slice(0, -"SKILL.md".length);
    if (prefix.split("/").filter(Boolean).length > 1
      || entries.some(e => !e.fileName.startsWith(prefix))) throw new Error("Invalid Skill Hub ZIP root");
    for (const entry of entries) {
      const destination = path.join(target, entry.fileName);
      if (entry.fileName.endsWith("/")) { await mkdir(destination, { recursive: true }); continue; }
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
        zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream!));
      });
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > entry.uncompressedSize || size > MAX_EXPANDED) throw new Error("Skill Hub ZIP expanded size mismatch");
        chunks.push(Buffer.from(chunk));
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.concat(chunks), { flag: "wx", mode: (entry.externalFileAttributes >>> 16) & 0o111 ? 0o700 : 0o600 });
    }
    return path.join(target, prefix);
  } finally { zip.close(); }
}

export async function installSkillHubSkill(id: string, destinationRoot: string, context?: HubRequest): Promise<string> {
  if (!ID.test(id)) throw new Error("Invalid Skill Hub skill id");
  const detail = await json(`desktop/skills/${id}`, context);
  if (!validSkill(detail) || detail.skillCode !== id || (skillHubManaged(context) && (detail as HubSkill & { installable?: boolean }).installable !== true)
    || typeof detail.packageSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(detail.packageSha256)
    || typeof detail.packageSize !== "number" || !Number.isSafeInteger(detail.packageSize) || detail.packageSize <= 0 || detail.packageSize > MAX_ARCHIVE) {
    throw new Error("Invalid Skill Hub release metadata");
  }
  const bytes = await request(`desktop/skills/${id}/releases/${detail.releaseId}/package`, MAX_ARCHIVE, context);
  if (bytes.length !== detail.packageSize || createHash("sha256").update(bytes).digest("hex") !== detail.packageSha256.toLowerCase()) {
    throw new Error("Skill Hub archive checksum or size mismatch");
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "pi-skill-hub-"));
  try {
    const source = await unpackSkillHubZip(bytes, temporary);
    // The shared installer validates the manifest, preserves files and refuses overwrites.
    const destination = await installMarketSkillSource(source, destinationRoot);
    console.log(`[skill-hub/install] Installed ${id}`);
    return path.basename(destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
