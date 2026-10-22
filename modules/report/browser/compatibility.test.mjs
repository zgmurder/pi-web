import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = name => readFile(new URL(`./connector/${name}`, import.meta.url), "utf8");

test("credential migration commits privately before deleting legacy storage; failures block and can retry", async () => {
  const legacy = { reportTrustedOrigin: "http://fixture", piChromeConnectorConfig: { token: "fixture-token" } };
  const saved = {};
  let fail = true, failRemove = false;
  const context = vm.createContext({ chrome: { storage: { local: {
    async get() { return { ...legacy }; },
    async remove(keys) { if (failRemove) throw new Error("remove failure"); for (const key of keys) delete legacy[key]; },
  } } }, saved, failWrite: () => fail });
  vm.runInContext(await source("private-store.js"), context);
  vm.runInContext(`reportPrivateStore.get = async () => ({ ...saved });
    reportPrivateStore.set = async values => { if (failWrite()) throw Error('disk failure'); Object.assign(saved, values); };`, context);
  await assert.rejects(vm.runInContext("reportStorageReady()", context), /初始化失败/);
  assert.ok(legacy.piChromeConnectorConfig);
  assert.deepEqual(saved, {});
  fail = false;
  failRemove = true;
  await assert.rejects(vm.runInContext("reportStorageReady()", context), /初始化失败/);
  assert.ok(legacy.piChromeConnectorConfig);
  assert.equal(saved.piChromeConnectorConfig.token, "fixture-token");
  failRemove = false;
  await vm.runInContext("reportStorageReady()", context);
  assert.equal(saved.piChromeConnectorConfig.token, "fixture-token");
  assert.deepEqual(legacy, {});
  // A completed private migration wins over an old leftover copy after a restart.
  legacy.piChromeConnectorConfig = { token: "stale-token" };
  vm.runInContext("reportStorageInitialization = undefined", context);
  await vm.runInContext("reportStorageReady()", context);
  assert.equal(saved.piChromeConnectorConfig.token, "fixture-token");
  assert.deepEqual(legacy, {});
  const worker = await source("service_worker.js");
  assert.match(worker, /await reportStorageReady\(\)/);
  assert.doesNotMatch(worker, /chrome\.storage\.local\.get\(CONNECTOR_CONFIG_KEY\)/);
});

test("Chrome 109 callback debugger waits for completion and propagates runtime.lastError", async () => {
  let callback;
  const chrome = { runtime: {}, debugger: { attach(_target, _version, done) { callback = done; } } };
  const context = vm.createContext({ chrome });
  vm.runInContext(await source("chrome-compat.js"), context);
  let done = false;
  const pending = vm.runInContext('reportDebuggerCall("attach", {tabId: 1}, "1.3")', context).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  callback();
  await pending;
  assert.equal(done, true);
  const failed = vm.runInContext('reportDebuggerCall("attach", {tabId: 1}, "1.3")', context);
  chrome.runtime.lastError = { message: "Permission denied" };
  callback();
  delete chrome.runtime.lastError;
  await assert.rejects(failed, /Permission denied/);
  const worker = await source("service_worker.js");
  assert.match(worker, /^importScripts\("private-store\.js", "chrome-compat\.js", "report-bridge\.js"\);/);
  assert.doesNotMatch(worker, /chrome\.debugger\.(attach|detach)\(/);
  assert.match(worker, /periodInMinutes: 1/);
  const manifest = JSON.parse(await source("manifest.json"));
  assert.equal(manifest.minimum_chrome_version, "109");
  const extension = await readFile(new URL("./extension.ts", import.meta.url), "utf8");
  assert.match(extension, new RegExp(`"${manifest.version.replaceAll(".", "\\.")}"`));
});

test("popup reports background failures, retries, and times out without enabling trust", async () => {
  const nodes = Object.fromEntries(["trust", "approve", "forget", "retry", "origin", "request", "session", "status"].map(id => [id, { addEventListener(_event, fn) { this.click = fn; } }]));
  let respond = () => Promise.reject(new Error("Could not establish connection"));
  let timeout;
  const context = vm.createContext({
    document: { getElementById: id => nodes[id] },
    chrome: { runtime: { sendMessage: () => respond() }, action: { async setBadgeText() {} } },
    setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {},
  });
  vm.runInContext(await source("popup.js"), context);
  const drain = () => new Promise(resolve => setImmediate(resolve));
  await drain();
  assert.match(nodes.status.textContent, /Could not establish connection/);
  assert.equal(nodes.trust.disabled, true);
  assert.equal(nodes.retry.disabled, false);
  respond = async () => ({ origin: "http://fixture", trusted: false });
  nodes.retry.click(); await drain();
  assert.equal(nodes.origin.textContent, "http://fixture");
  assert.equal(nodes.trust.disabled, false);
  respond = () => new Promise(() => {});
  nodes.retry.click(); timeout(); await drain();
  assert.match(nodes.status.textContent, /超时/);
  assert.equal(nodes.trust.disabled, true);
  assert.equal(nodes.retry.disabled, false);
});
