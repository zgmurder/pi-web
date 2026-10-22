// Disposable Chrome profile + local HTTP fixtures only. Never touches a user's profile/accounts/model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { deviceRequest } = await jiti.import("./http.ts");
const { getChromeGateway, resetChromeGatewayForTests } = await jiti.import("./gateway.ts");
const root = await mkdtemp(join(tmpdir(), "report-connector-e2e-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
resetChromeGatewayForTests();
let context;
let origin;
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/chrome-gateway/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      const request = new Request(origin + req.url, { method: req.method, headers: req.headers, signal: controller.signal,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = await deviceRequest(request);
      if (response.status >= 400) console.error("Device fixture refusal", req.url.split("?")[0], response.status, { origin: req.headers.origin, fetchSite: req.headers["sec-fetch-site"] });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } else {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end('<title>Report connector fixture</title><h1>查询测试页</h1><label>查询<input id="query"></label><input id="password" type="password" value="fixture-only-secret"><button id="search" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#query\').value">查询</button><p id="result">等待查询</p>');
    }
  } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
try {
  const executablePath = process.env.PI_WEB_TEST_CHROME_EXECUTABLE;
  const extensionPath = fileURLToPath(new URL("./connector", import.meta.url));
  context = await chromium.launchPersistentContext(join(root, "chrome"), {
    ...(executablePath ? { executablePath } : { channel: process.env.PI_WEB_TEST_CHANNEL || "chrome" }), headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: executablePath ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : ["--enable-unsafe-extension-debugging"],
  });
  if (!executablePath) {
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send("Extensions.loadUnpacked", { path: extensionPath });
  }
  const worker = context.serviceWorkers().find(w => w.url().startsWith("chrome-extension://")) || await context.waitForEvent("serviceworker", { predicate: w => w.url().startsWith("chrome-extension://"), timeout: 15000 });
  console.log(`Chrome fixture version: ${context.browser().version()}`);
  const page = context.pages()[0] || await context.newPage();
  await page.goto(origin);
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url.startsWith(origin)).id, origin);
  await page.bringToFront();
  // Playwright does not expose action-popup targets. Invoke its handler in the real worker;
  // sender identity checks are covered separately by connector.test.mjs.
  const send = (type, fields = {}) => worker.evaluate(message => reportMessage(message, { url: chrome.runtime.getURL("popup.html") }), { type, ...fields });
  const trust = await send("report-trust", { origin });
  assert.equal(trust.ok, true, JSON.stringify(trust));
  async function bridge(action, fields = {}) {
    return page.evaluate(({ action, fields }) => new Promise((resolve, reject) => {
      const id = `fixture-${Date.now()}`;
      const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Bridge timed out")); }, 5000);
      function receive(event) {
        if (event.data?.source !== "report-connector" || event.data.id !== id) return;
        clearTimeout(timer); window.removeEventListener("message", receive); resolve(event.data.response);
      }
      window.addEventListener("message", receive);
      window.postMessage({ source: "report-web", id, action, ...fields }, location.origin);
    }), { action, fields });
  }
  assert.equal((await bridge("status")).trusted, true);
  const gateway = getChromeGateway();
  const sessionId = "fixture-session";
  const pair = gateway.createPair(sessionId);
  assert.equal((await bridge("pair", { code: pair.code, sessionId })).pending, true);
  assert.equal(gateway.status(sessionId).paired, false);
  assert.equal((await send("report-approve", { origin, sessionId })).ok, true);
  for (let i = 0; i < 100 && !gateway.status(sessionId).connected; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(gateway.status(sessionId).connected, true);
  // Real IndexedDB transactions, legacy migration and aborted writes (fixture credentials only).
  assert.equal(await worker.evaluate(async () => {
    const config = (await reportPrivateStore.get("piChromeConnectorConfig")).piChromeConnectorConfig;
    if (!config?.token || (await chrome.storage.local.get("piChromeConnectorConfig")).piChromeConnectorConfig) return false;
    await chrome.storage.local.set({ piChromeConnectorConfig: config });
    reportStorageInitialization = undefined;
    await reportStorageReady();
    if ((await chrome.storage.local.get("piChromeConnectorConfig")).piChromeConnectorConfig) return false;
    try {
      await reportPrivateStore.transact("readwrite", store => { store.put("should-not-commit", "abort-test"); store.transaction.abort(); return () => undefined; });
      return false;
    } catch { /* Expected transaction abort. */ }
    return (await reportPrivateStore.get("abort-test"))["abort-test"] === undefined && (await connectorConfig()).token === config.token;
  }), true);
  assert.equal(await worker.evaluate(async tabId => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      const local = await chrome.storage.local.get("piChromeConnectorConfig");
      const databases = await indexedDB.databases();
      return !local.piChromeConnectorConfig && !databases.some(db => db.name === "report-connector-private");
    } });
    return result.result;
  }, tabId), true);
  const command = (action, params = {}) => gateway.sendCommand(sessionId, action, { ...params, sessionKey: sessionId, background: true, foreground: false }, 35_000, "0.15.59");
  const tabs = await command("tab.list");
  assert.ok(tabs.some(tab => tab.url?.startsWith(origin)));
  const targetId = String(tabId);
  const snapshot = await command("page.snapshot", { targetId, maxElements: 50 });
  assert.match(JSON.stringify(snapshot), /查询测试页/);
  assert.doesNotMatch(JSON.stringify(snapshot), /fixture-only-secret/);
  await command("page.fill", { targetId, selector: "#query", text: "fixture query" });
  await command("page.click", { targetId, selector: "#search" });
  assert.equal(await page.locator("#result").textContent(), "fixture query");
  await command("page.key", { targetId, key: "Tab" });
  await command("page.scroll", { targetId, deltaY: 100 });
  await command("page.navigate", { url: origin + "/opened" });
  console.log("PASS real Chrome extension: private storage/migration/abort/isolation, site trust, pairing, HTTP polling, seven permitted actions");
  await gateway.unpair(sessionId);
  assert.equal(gateway.status(sessionId).paired, false);
  await assert.rejects(command("tab.list"), /No Chrome device/);
  assert.equal((await send("report-forget")).ok, true);
  assert.equal(await worker.evaluate(async () => (await reportPrivateStore.get("piChromeConnectorConfig")).piChromeConnectorConfig === undefined), true);
  assert.ok((await bridge("status")).error);
  console.log("PASS disconnect and forgetting trust block further session commands");
} finally {
  await context?.close();
  resetChromeGatewayForTests();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
