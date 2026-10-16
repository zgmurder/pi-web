import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { readRegularFileText } from "./regular-file";
import type { LocalMarketCatalog, LocalMarketPlugin, LocalMarketSkill } from "./api-types";

type MarketPluginSource = LocalMarketPlugin & { source: string };
type MarketSkillSource = LocalMarketSkill & { source: string };

const MANIFEST_MAX_BYTES = 1024 * 1024;
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function getLocalMarketRoot(): string {
  return path.resolve(process.env.PI_WEB_MARKET_DIR || path.join(process.cwd(), "market"));
}

async function childDirectories(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readPlugins(root: string, diagnostics: string[]): Promise<MarketPluginSource[]> {
  const plugins: MarketPluginSource[] = [];
  for (const id of await childDirectories(root)) {
    const source = path.join(root, id);
    try {
      const raw = readRegularFileText(path.join(source, "package.json"), MANIFEST_MAX_BYTES);
      if (!raw) throw new Error("package.json not found");
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      plugins.push({
        id,
        name: text(pkg.name) ?? id,
        ...(text(pkg.description) && { description: text(pkg.description) }),
        ...(text(pkg.version) && { version: text(pkg.version) }),
        source,
      });
    } catch (error) {
      diagnostics.push(`plugins/${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return plugins;
}

async function readSkills(root: string, diagnostics: string[]): Promise<MarketSkillSource[]> {
  const skills: MarketSkillSource[] = [];
  for (const id of await childDirectories(root)) {
    const source = path.join(root, id);
    try {
      const raw = readRegularFileText(path.join(source, "SKILL.md"), MANIFEST_MAX_BYTES);
      if (!raw) throw new Error("SKILL.md not found");
      const data = parseFrontmatter(raw).data;
      const name = text(data?.name);
      const description = text(data?.description);
      if (!name || !SKILL_NAME_RE.test(name) || name.length > 64) throw new Error("invalid skill name");
      if (!description || description.length > 1024) throw new Error("invalid skill description");
      skills.push({ id, name, description, source });
    } catch (error) {
      diagnostics.push(`skills/${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return skills;
}

export async function readLocalMarket(): Promise<LocalMarketCatalog> {
  const root = getLocalMarketRoot();
  const diagnostics: string[] = [];
  const [plugins, skills] = await Promise.all([
    readPlugins(path.join(root, "plugins"), diagnostics),
    readSkills(path.join(root, "skills"), diagnostics),
  ]);
  return {
    root,
    plugins: plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      ...(plugin.description && { description: plugin.description }),
      ...(plugin.version && { version: plugin.version }),
    })),
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
    })),
    diagnostics,
  };
}

async function resolveLocalMarketPlugin(id: string): Promise<MarketPluginSource | undefined> {
  const diagnostics: string[] = [];
  return (await readPlugins(path.join(getLocalMarketRoot(), "plugins"), diagnostics))
    .find((plugin) => plugin.id === id);
}

async function resolveLocalMarketSkill(id: string): Promise<MarketSkillSource | undefined> {
  const diagnostics: string[] = [];
  return (await readSkills(path.join(getLocalMarketRoot(), "skills"), diagnostics))
    .find((skill) => skill.id === id);
}

export async function getLocalMarketPluginPath(id: string): Promise<string | undefined> {
  return (await resolveLocalMarketPlugin(id))?.source;
}

export async function installLocalMarketSkill(id: string, destinationRoot: string): Promise<string> {
  const skill = await resolveLocalMarketSkill(id);
  if (!skill) throw new Error("Market skill not found");

  const destination = path.join(destinationRoot, skill.name);
  try {
    await lstat(destination);
    throw new Error(`Skill already exists: ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(destinationRoot, { recursive: true });
  try {
    await cp(skill.source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: async (source) => {
        const stats = await lstat(source);
        if (!stats.isDirectory() && !stats.isFile()) {
          throw new Error(`Market skill contains an unsupported link or file: ${source}`);
        }
        return true;
      },
    });
    return destination;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
