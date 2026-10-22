import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("./connector/report-bridge.js", import.meta.url), "utf8");
function fixture() {
  const local = {}, session = {}, privateData = {};
  const storage = data => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])); },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  });
  const id = "a".repeat(32), origin = "http://127.0.0.1:30142";
  const tab = { id: 1, url: origin + "/?session=session-a" };
  const popup = { url: `chrome-extension://${id}/popup.html` };
  const page = { url: tab.url, frameId: 0, tab };
  let listener, calls = 0, changes = 0;
  const context = vm.createContext({ URL, Date, AbortSignal,
    reportPrivateStore: storage(privateData), async reportStorageReady() {},
    reportConfigChanged() { changes++; },
    chrome: {
      storage: { local: storage(local), session: storage(session) },
      runtime: { getURL: path => `chrome-extension://${id}/${path}`, onMessage: { addListener(value) { listener = value; } } },
      tabs: { async query() { return [tab]; }, async get() { return tab; } },
      scripting: { async unregisterContentScripts() {}, async registerContentScripts() {}, async executeScript() {} },
      action: { async setBadgeText() {} },
    },
    async fetch(url, init) {
      calls++;
      assert.equal(url, origin + "/api/chrome-gateway/pair/claim");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      assert.equal(body.code, "AAAA-" + "B".repeat(28));
      return Response.json({ deviceId: "device", token: "t".repeat(43), sessionId: "session-a" });
    },
  });
  vm.runInContext(source, context);
  async function send(type, sender, fields = {}) {
    const result = await new Promise(resolve => listener({ type, ...fields }, sender, resolve));
    await new Promise(resolve => setImmediate(resolve));
    return result;
  }
  return { local, privateData, session, tab, popup, page, origin, send, calls: () => calls, changes: () => changes };
}

test("extension requires popup site trust and a second session approval, never shares tokens", async () => {
  const f = fixture();
  assert.match((await f.send("report-status", f.page)).error, /授权/);
  assert.ok((await f.send("report-trust", f.page, { origin: f.origin })).error);
  assert.ok((await f.send("report-trust", f.popup, { origin: "http://elsewhere" })).error);
  assert.equal((await f.send("report-trust", f.popup, { origin: f.origin })).ok, true);
  const status = await f.send("report-status", f.page);
  assert.equal(status.trusted, true);
  const fields = { code: "AAAA-" + "B".repeat(28), sessionId: "session-a" };
  assert.ok((await f.send("report-pair", { ...f.page, frameId: 1 }, fields)).error);
  assert.ok((await f.send("report-pair", { ...f.page, url: "http://127.0.0.1:30143/" }, fields)).error);
  assert.equal((await f.send("report-pair", f.page, fields)).pending, true);
  assert.equal(f.calls(), 0);
  assert.equal((await f.send("report-approve", f.popup, { origin: f.origin, sessionId: "session-a" })).ok, true);
  assert.equal(f.calls(), 1);
  assert.equal(f.privateData.piChromeConnectorConfig.token, "t".repeat(43));
  assert.equal(f.local.piChromeConnectorConfig, undefined);
  assert.equal(Object.hasOwn(await f.send("report-status", f.page), "token"), false);
  assert.equal((await f.send("report-forget", f.popup)).ok, true);
  assert.equal(f.local.piChromeConnectorConfig, undefined);
  assert.equal(f.privateData.piChromeConnectorConfig, undefined);
  assert.equal(f.privateData.reportTrustedOrigin, undefined);
  assert.equal(f.changes(), 2);
});

test("expired, changed-tab and superseded session approvals cannot claim", async () => {
  const f = fixture();
  await f.send("report-trust", f.popup, { origin: f.origin });
  const fields = { code: "AAAA-" + "B".repeat(28), sessionId: "session-a" };
  await f.send("report-pair", f.page, fields);
  f.session.reportPendingPair.expiresAt = 0;
  assert.ok((await f.send("report-approve", f.popup, { origin: f.origin, sessionId: "session-a" })).error);
  await f.send("report-pair", f.page, fields);
  assert.ok((await f.send("report-approve", f.popup, { origin: f.origin, sessionId: "session-b" })).error);
  await f.send("report-pair", f.page, fields);
  f.tab.url = "https://elsewhere.test";
  assert.ok((await f.send("report-approve", f.popup, { origin: f.origin, sessionId: "session-a" })).error);
  assert.equal(f.calls(), 0);
});
