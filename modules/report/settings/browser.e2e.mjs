// Disposable Chrome and local fixture only: no real systems, accounts or model requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { changeSystem } = await jiti.import("./systems.ts");
const { openSystem, testBrowser } = await jiti.import("./browser.ts");
const root = await mkdtemp(join(tmpdir(), "report-browser-e2e-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
let submissions = 0;
const server = createServer((req, res) => {
  if (req.url === "/redirect") { res.writeHead(302, { location: `http://localhost:${server.address().port}/login` }); res.end(); return; }
  if (req.url.startsWith("/submit")) { submissions++; res.end("fixture logged in"); return; }
  res.setHeader("content-type", "text/html");
  res.end('<form action="/submit"><input id="username" name="username"><input id="password" type="password" name="password"><button id="login">Login</button></form>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PI_WEB_TEST_CHANNEL || "chrome", args: [`--remote-debugging-port=${port}`] });
  await browser.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await testBrowser(port);
  const source = { name: "Fixture", url: url + "/login", port, username: "fixture-user", password: "fixture-only-secret", usernameSelector: "#username", passwordSelector: "#password", submitSelector: "#login" };
  const [saved] = await changeSystem("save", source);
  const opened = await openSystem(saved.id, "open");
  assert.equal(opened.port, port);
  assert.equal(submissions, 0);
  const logged = await openSystem(saved.id, "login");
  assert.ok(logged.tabId);
  assert.ok(!JSON.stringify(logged).includes(source.password));
  for (let i = 0; i < 30 && submissions === 0; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(submissions, 1);
  console.log("PASS local Chrome connection, opening, credential submission and redacted result");
  await changeSystem("save", { ...source, id: saved.id, url: url + "/redirect" });
  await assert.rejects(openSystem(saved.id, "login"), /浏览器操作失败/);
  assert.equal(submissions, 1);
  await changeSystem("save", { ...source, id: saved.id, passwordSelector: "#missing" });
  await assert.rejects(openSystem(saved.id, "login"), /浏览器操作失败/);
  assert.equal(submissions, 1);
  console.log("PASS cross-origin redirects and missing fields refuse credential submission");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(root, { recursive: true, force: true });
}
