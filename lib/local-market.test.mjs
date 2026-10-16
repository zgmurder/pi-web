import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-market-"));
const previousRoot = process.env.PI_WEB_MARKET_DIR;
process.env.PI_WEB_MARKET_DIR = root;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { getLocalMarketPluginPath, installLocalMarketSkill, readLocalMarket } = await jiti.import("./local-market.ts");

after(async () => {
  if (previousRoot === undefined) delete process.env.PI_WEB_MARKET_DIR;
  else process.env.PI_WEB_MARKET_DIR = previousRoot;
  await rm(root, { recursive: true, force: true });
});

test("lists unpacked plugins and skills and reports invalid entries", async () => {
  await mkdir(join(root, "plugins", "demo"), { recursive: true });
  await writeFile(join(root, "plugins", "demo", "package.json"), JSON.stringify({
    name: "@company/demo",
    version: "1.0.0",
    description: "Demo plugin",
  }));
  await mkdir(join(root, "skills", "hello"), { recursive: true });
  await writeFile(join(root, "skills", "hello", "SKILL.md"), "---\nname: hello\ndescription: Hello skill\n---\n");
  await mkdir(join(root, "skills", "broken"), { recursive: true });
  await writeFile(join(root, "skills", "broken", "SKILL.md"), "# Missing frontmatter\n");

  const market = await readLocalMarket();
  assert.deepEqual(market.plugins.map(({ name, version }) => ({ name, version })), [
    { name: "@company/demo", version: "1.0.0" },
  ]);
  assert.equal("source" in market.plugins[0], false, "the route model does not expose server paths");
  assert.equal(await getLocalMarketPluginPath("demo"), join(root, "plugins", "demo"));
  assert.deepEqual(market.skills.map(({ name, description }) => ({ name, description })), [
    { name: "hello", description: "Hello skill" },
  ]);
  assert.match(market.diagnostics.join("\n"), /skills\/broken/);
});

test("copies a market skill once and refuses overwrite", async () => {
  const destination = join(root, "installed");
  const installed = await installLocalMarketSkill("hello", destination);
  assert.equal(installed, join(destination, "hello"));
  await assert.rejects(() => installLocalMarketSkill("hello", destination), /already exists/);
});

test("refuses linked skill content and removes the partial copy", async () => {
  const source = join(root, "skills", "linked");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "---\nname: linked\ndescription: Linked skill\n---\n");
  try {
    const { symlink } = await import("node:fs/promises");
    await symlink(join(root, "skills", "hello", "SKILL.md"), join(source, "outside.md"));
  } catch {
    return;
  }

  const destination = join(root, "linked-installed");
  await assert.rejects(() => installLocalMarketSkill("linked", destination), /unsupported link/);
  const { access } = await import("node:fs/promises");
  await assert.rejects(() => access(join(destination, "linked")));
});
