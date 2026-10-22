import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseSystem, changeSystem, listSystems, getSystem } = await jiti.import("./systems.ts");
const source = { name: "测试系统", url: "https://example.test/login", port: 9333, username: "operator", password: "test-only-secret", notes: "仅查询", usernameSelector: "#username", passwordSelector: "#password", submitSelector: "#login" };

test("system validation bounds URLs, ports, identifiers and fields", () => {
  assert.equal(parseSystem(source).url, source.url);
  for (const input of [null, [], {}, { ...source, name: " " }, { ...source, url: "file:///etc/passwd" }, { ...source, url: "https://u:p@example.test" }, { ...source, port: 0 }, { ...source, port: 1.5 }, { ...source, port: 65536 }, { ...source, id: "../x" }, { ...source, username: "x\ny" }, { ...source, notes: "x".repeat(4001) }]) assert.throws(() => parseSystem(input));
});

test("private CRUD preserves only same-target credentials, clears explicitly and refuses corrupt overwrites", async () => {
  const root = await mkdtemp(join(tmpdir(), "report-systems-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const [saved] = await changeSystem("save", source);
    assert.equal(saved.hasPassword, true);
    assert.equal(Object.hasOwn(saved, "password"), false);
    assert.ok(!JSON.stringify(listSystems()).includes(source.password));
    await changeSystem("save", { ...saved, name: "改名", password: "" });
    assert.equal(getSystem(saved.id).password, source.password);
    for (const change of [{ url: "https://other.test/login" }, { username: "other" }, { port: 9334 }]) {
      await changeSystem("save", { ...saved, password: source.password });
      await changeSystem("save", { ...saved, ...change });
      assert.equal(getSystem(saved.id).password, "");
    }
    await changeSystem("save", { ...saved, password: source.password });
    await changeSystem("save", { ...saved, clearPassword: true });
    assert.equal(getSystem(saved.id).password, "");
    await Promise.all([changeSystem("save", { ...source, name: "二" }), changeSystem("save", { ...source, name: "三" })]);
    assert.equal(listSystems().length, 3);
    await changeSystem("delete", saved.id);
    assert.throws(() => getSystem(saved.id));
    await assert.rejects(changeSystem("save", saved));
    const path = join(root, "report-business-systems.json");
    await writeFile(path, "corrupt private configuration");
    await assert.rejects(changeSystem("save", source), /原文件不会被覆盖/);
    assert.equal(await readFile(path, "utf8"), "corrupt private configuration");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("API refuses cross-origin, bad content type, oversized JSON and invalid actions", async () => {
  const { POST } = await jiti.import("../../../app/api/report/systems/route.ts");
  const request = (body, headers = {}) => new Request("http://localhost:30142/api/report/systems", { method: "POST", headers: { host: "localhost:30142", origin: "http://localhost:30142", "content-type": "application/json", ...headers }, body });
  assert.equal((await POST(request("{}", { origin: "https://evil.test" }))).status, 403);
  assert.equal((await POST(request("{}", { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request("x".repeat(20001)))).status, 413);
  for (const body of ["broken", "null", "[]", '{"action":"unknown"}', '{"action":"test","port":0}']) assert.equal((await POST(request(body))).status, 400);
});

test("browser test refuses non-Chrome, redirects, oversized responses and unbounded ports", async () => {
  const { testBrowser } = await jiti.import("./browser.ts");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "http://127.0.0.1:9333/json/version");
      assert.equal(init.redirect, "error");
      return Response.json({ Browser: "Chrome/test", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/test" });
    };
    assert.match((await testBrowser(9333)).message, /正常/);
    await assert.rejects(testBrowser(-1));
    for (const response of [Response.json({}), new Response("x".repeat(17000)), new Response("", { status: 302 })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(testBrowser(9333), /无法连接/);
    }
  } finally { globalThis.fetch = original; }
});

test("model tool lists only public instructions and requires UI confirmation before opening", async () => {
  const root = await mkdtemp(join(tmpdir(), "report-system-tool-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const [saved] = await changeSystem("save", source);
    const { createBusinessSystemExtension } = await jiti.import("./extension.ts");
    let tool;
    createBusinessSystemExtension().factory({ registerTool: value => { tool = value; } });
    const response = await tool.execute("test", { action: "list" });
    assert.deepEqual(JSON.parse(response.content[0].text), [{ id: saved.id, name: source.name, notes: source.notes }]);
    assert.ok(!JSON.stringify(response).includes(source.password));
    await assert.rejects(tool.execute("test", { action: "login", id: saved.id }, undefined, undefined, { hasUI: false }), /交互确认/);
    await assert.rejects(tool.execute("test", { action: "login", id: saved.id }, undefined, undefined, { hasUI: true, ui: { confirm: async () => false } }), /取消/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
