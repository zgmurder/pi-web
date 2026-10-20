import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { t as listTar, x as extractTar } from "tar";
import { serializeByKey } from "./key-serializer";
import { parseFrontmatter } from "./frontmatter";
import type { LocalMarketCatalog } from "./api-types";

const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_EXPANDED = 140 * 1024 * 1024;
type Kind = "skill" | "plugin";
type RemoteResource = { id: string; kind: Kind; name: string; description: string; version: string; sha256: string; archiveSize: number };

export function remoteMarketUrl(): URL | undefined {
  const value = process.env.PI_WEB_MARKET_URL?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PI_WEB_MARKET_URL must be an HTTP(S) origin without credentials or a path");
  }
  return url;
}
function validResource(value: unknown): value is RemoteResource {
  if (!value || typeof value !== "object") return false;
  const r = value as RemoteResource;
  return ["skill", "plugin"].includes(r.kind) && typeof r.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id) && r.id.length <= 64
    && typeof r.name === "string" && r.name.length > 0 && r.name.length <= 128
    && typeof r.description === "string" && r.description.length <= 1024
    && typeof r.version === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(r.version) && r.version.length <= 64
    && typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256)
    && Number.isSafeInteger(r.archiveSize) && r.archiveSize > 0 && r.archiveSize <= MAX_ARCHIVE;
}
async function fetchBytes(url: URL, limit: number): Promise<Buffer> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Market request failed (HTTP ${response.status})`);
  if (!response.body) throw new Error("Empty market response");
  const reader = response.body.getReader();
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Market response exceeds size limit");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export async function readRemoteMarket(): Promise<LocalMarketCatalog> {
  const origin = remoteMarketUrl();
  if (!origin) throw new Error("Remote market is not configured");
  const result = JSON.parse((await fetchBytes(new URL("/api/resources", origin), 8 * 1024 * 1024)).toString("utf8"));
  if (!Array.isArray(result.resources) || result.resources.length > 500 || !result.resources.every(validResource)) throw new Error("Invalid market catalogue");
  const resources = result.resources as RemoteResource[];
  return {
    root: origin.origin, websiteUrl: origin.origin,
    plugins: resources.filter(r => r.kind === "plugin").map(r => ({ id: r.id, name: r.name, description: r.description, version: r.version, detailUrl: new URL(`/resources/plugin/${r.id}`, origin).href })),
    skills: resources.filter(r => r.kind === "skill").map(r => {
      const readme = (r as RemoteResource & { readme?: unknown }).readme;
      const name = typeof readme === "string" ? parseFrontmatter(readme).data?.name : undefined;
      if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error("Invalid market skill manifest");
      return { id: r.id, name, displayName: r.name, description: r.description, version: r.version, detailUrl: new URL(`/resources/skill/${r.id}`, origin).href };
    }),
    diagnostics: [],
  };
}
export function safeMarketEntry(name: string): boolean {
  return name.length > 0 && name.length <= 512 && name.split("/").every(p => p && p !== "." && p !== ".."
    && !/[\\:\x00-\x1f<>"|?*]/.test(p) && !/[. ]$/.test(p)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
export async function unpackMarketArchive(bytes: Buffer, sha256: string, target: string): Promise<void> {
  if (bytes.length > MAX_ARCHIVE || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Market archive checksum mismatch");
  const tarBytes = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED });
  const tarFile = `${target}.tar`;
  try {
    await writeFile(tarFile, tarBytes, { flag: "wx" });
    const seen = new Set<string>(); let total = 0; let invalid = false;
    await listTar({ file: tarFile, strict: true, onReadEntry(entry) {
      const name = entry.path;
      const key = name.toLowerCase();
      total += entry.size;
      if (entry.type !== "File" || !safeMarketEntry(name) || seen.has(key) || seen.size >= 5000 || total > 128 * 1024 * 1024) invalid = true;
      seen.add(key);
    } });
    if (invalid || !seen.size) throw new Error("Market archive contains unsafe paths, links, duplicates or too many files");
    await mkdir(target, { recursive: true });
    await extractTar({ file: tarFile, cwd: target, strict: true, preservePaths: false, noChmod: true, noMtime: true });
  } finally { await rm(tarFile, { force: true }); }
}

export async function remoteMarketSource(kind: Kind, id: string): Promise<string> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) throw new Error("Invalid market resource id");
  const origin = remoteMarketUrl();
  if (!origin) throw new Error("Remote market is not configured");
  const resource = JSON.parse((await fetchBytes(new URL(`/api/resources/${kind}/${id}`, origin), 2 * 1024 * 1024)).toString("utf8"));
  if (!validResource(resource) || resource.kind !== kind || resource.id !== id) throw new Error("Invalid market resource");
  const sourceKey = createHash("sha256").update(origin.origin).digest("hex").slice(0, 16);
  const root = path.join(getAgentDir(), "market-packages", sourceKey);
  const destination = path.join(root, `${kind}-${id}-${resource.sha256}`);
  return serializeByKey(Symbol.for("pi-web:market-download"), destination, async () => {
    try {
      const stat = await lstat(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid market cache directory");
      return destination;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await mkdir(root, { recursive: true });
    const temporary = await mkdtemp(path.join(root, ".download-"));
    const content = path.join(temporary, "content");
    try {
      const url = new URL(`/api/resources/${kind}/${id}/download`, origin);
      url.searchParams.set("version", resource.version);
      const bytes = await fetchBytes(url, MAX_ARCHIVE);
      if (bytes.length !== resource.archiveSize) throw new Error("Market archive size mismatch");
      await unpackMarketArchive(bytes, resource.sha256, content);
      if (kind === "plugin") {
        const pkg = JSON.parse(await readFile(path.join(content, "package.json"), "utf8"));
        if (pkg.version !== resource.version || typeof pkg.name !== "string" || !pkg.name) throw new Error("Invalid market plugin manifest");
        if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.optionalDependencies || {}).length) throw new Error("Market plugins must bundle their runtime dependencies");
      }
      await rename(content, destination);
      console.log(`[market/install] Prepared ${kind}/${id}@${resource.version}`);
      return destination;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}
