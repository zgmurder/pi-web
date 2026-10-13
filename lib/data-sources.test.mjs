import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { validateQuery, validateQueryRange, selectedDataSource, DATA_SOURCE_ENTRY } = await jiti.import("./data-sources-shared.ts");
const sql = "SELECT COUNT(DISTINCT id) AS total FROM alarms WHERE received_at >= :start AND received_at < :end";
test("templates accept aggregate queries and reject unsafe or unbounded inputs", () => {
  validateQuery(sql);
  for (const bad of ["DELETE FROM alarms", sql + "; SELECT 1", sql + " FOR UPDATE", sql + " INTO OUTFILE '/tmp/x'", sql + " /* hi */", "SELECT SLEEP(1) WHERE :start < :end", "SELECT * FROM alarms", sql + " AND id=:id", "SELECT @a:=1 WHERE :start < :end"]) assert.throws(() => validateQuery(bad));
  validateQueryRange("2026-10-11T16:00:00Z", "2026-10-12T07:00:00Z");
  for (const [start, end] of [["2026-10-12", "2026-10-13"], ["2026-10-12T00:00:00Z", "2026-10-12T00:00:00Z"], ["2026-01-01T00:00:00Z", "2026-10-12T00:00:00Z"]]) assert.throws(() => validateQueryRange(start, end));
});
test("selection follows only supplied branch and clear entry wins", () => {
  const entry = id => ({ type: "custom", customType: DATA_SOURCE_ENTRY, data: { id } });
  assert.equal(selectedDataSource([]), null);
  assert.equal(selectedDataSource([entry("one"), entry("two")]), "two");
  assert.equal(selectedDataSource([entry("one"), entry(null)]), null);
});
test("private storage omits password from public responses, retains it on edit, and refuses corrupt overwrites", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-data-sources-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const { changeDataSource, listDataSources, getDataSource } = await jiti.import("./data-sources.ts");
    const source = { name: "Police", host: "localhost", port: 3306, database: "test", user: "readonly", password: "never-return-this", tls: true, notes: "aggregates only", queries: [{ name: "total", description: "Total", sql }] };
    const [saved] = await changeDataSource("save", source);
    assert.equal(saved.hasPassword, true);
    assert.equal(JSON.stringify(listDataSources()).includes(source.password), false);
    assert.equal(Object.hasOwn(saved, "password"), false);
    await changeDataSource("save", { ...saved, name: "Renamed" });
    assert.equal(getDataSource(saved.id).password, source.password);
    await assert.rejects(changeDataSource("save", { ...saved, port: 0 }));
    await changeDataSource("delete", saved.id);
    assert.deepEqual(listDataSources(), []);
    const path = join(root, "pi-web-data-sources.json");
    await writeFile(path, "broken secret configuration");
    await assert.rejects(changeDataSource("save", source), /configuration is invalid/);
    assert.equal(await readFile(path, "utf8"), "broken secret configuration");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
