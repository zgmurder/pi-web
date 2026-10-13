import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform settings separate connection editing from source browsing", async () => {
  const source = await readFile(new URL("./ModelPlatformSources.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("./DataSourcesConfig.tsx", import.meta.url), "utf8");
  assert.match(panel, /useState<"platform" \| "local">\("platform"\)/);
  assert.match(source, /ConfigSidebarItem/);
  assert.match(source, /action=sources/);
  assert.match(source, /platformEmpty/);
  assert.match(source, /platformUnavailable/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /if \(offset === null\) return/);
  assert.match(source, /action: "schema"/);
  assert.doesNotMatch(source, /action: "sql"|\/preview/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /data\.nextOffset/);
  const css = await readFile(new URL("./DataSourcesConfig.module.css", import.meta.url), "utf8");
  assert.match(css, /config-sidebar-item\)\s*\{[^}]*height: auto;[^}]*min-height: 52px/);
  assert.match(css, /@container \(max-width: 620px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});
