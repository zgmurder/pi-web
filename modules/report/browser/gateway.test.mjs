import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
const instances = [];
after(() => { for (const { gateway, dir } of instances) { gateway.close(); rmSync(dir, { recursive: true, force: true }); } });
import { createJiti } from "jiti";
import lockfile from "proper-lockfile";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { ChromeGateway, ChromeGatewayError } = await jiti.import("./gateway.ts");

function gateway() {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-chrome-gateway-"));
  const path = join(dir, "devices.json");
  const result = { gateway: new ChromeGateway(path), path, dir };
  instances.push(result);
  return result;
}

test("pairs a device without persisting its plaintext token", async () => {
  const { gateway: instance, path } = gateway();
  const pair = instance.createPair("session-a");
  const claimed = await instance.claimPair({ code: pair.code, name: " Alice Chrome " });

  assert.equal(claimed.name, "Alice Chrome");
  assert.ok(claimed.token);
  assert.equal(instance.status("session-a").deviceId, claimed.deviceId);
  assert.doesNotMatch(readFileSync(path, "utf8"), new RegExp(claimed.token));
  await assert.rejects(instance.claimPair({ code: pair.code, name: "replay" }), /invalid or expired/);
  instance.close();
});

test("waits for another process's store lock before replacing state", async () => {
  const { gateway: instance, path } = gateway();
  const release = await lockfile.lock(path, { realpath: false });
  let settled = false;
  const claim = instance.claimPair({ code: instance.createPair("session-a").code, name: "A" }).then((value) => {
    settled = true;
    return value;
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(settled, false);
  await release();
  await claim;
  assert.equal(instance.status("session-a").paired, true);
  instance.close();
});

test("routes commands only through the session's paired device", async () => {
  const { gateway: instance } = gateway();
  const pairA = instance.createPair("session-a");
  const deviceA = await instance.claimPair({ code: pairA.code, name: "A" });
  const pairB = instance.createPair("session-b");
  const deviceB = await instance.claimPair({ code: pairB.code, name: "B" });

  const resultPromise = instance.sendCommand("session-a", "page.click", { uid: "e1" }, 2_000);
  const command = await instance.nextCommand(deviceA.deviceId, deviceA.token, {});
  assert.equal(command.action, "page.click");
  instance.submitResult(deviceA.deviceId, deviceA.token, { id: command.id, ok: true, result: { clicked: true } });
  assert.deepEqual(await resultPromise, { clicked: true });

  assert.throws(
    () => instance.submitResult(deviceB.deviceId, deviceB.token, { id: command.id, ok: true }),
    (error) => error instanceof ChromeGatewayError && error.code === "command-unknown",
  );
  instance.close();
});

test("one device receives only one command until its result returns", async () => {
  const { gateway: instance } = gateway();
  const pair = instance.createPair("session-a");
  const device = await instance.claimPair({ code: pair.code, name: "A" });
  const firstResult = instance.sendCommand("session-a", "first", {}, 2_000);
  const secondResult = instance.sendCommand("session-a", "second", {}, 2_000);

  const first = await instance.nextCommand(device.deviceId, device.token, {});
  assert.equal(first.action, "first");
  assert.equal(await instance.nextCommand(device.deviceId, device.token, {}), undefined);
  instance.submitResult(device.deviceId, device.token, { id: first.id, ok: true, result: 1 });
  assert.equal(await firstResult, 1);

  const second = await instance.nextCommand(device.deviceId, device.token, {});
  assert.equal(second.action, "second");
  instance.submitResult(device.deviceId, device.token, { id: second.id, ok: true, result: 2 });
  assert.equal(await secondResult, 2);
  instance.close();
});

test("pair cancellation, expiry, global rate limit and corrupt storage fail closed", async () => {
  const { gateway: instance, path } = gateway();
  const pair = instance.createPair("session-a");
  assert.match(pair.code, /^[A-Z2-9-]{33}$/);
  instance.cancelPair("session-a");
  await assert.rejects(instance.claimPair({ code: pair.code, name: "A" }), /invalid or expired/);
  const expired = instance.createPair("session-a");
  const now = Date.now;
  try {
    Date.now = () => now() + 121_000;
    await assert.rejects(instance.claimPair({ code: expired.code, name: "A" }), /invalid or expired/);
    for (let i = 0; i < 59; i++) await assert.rejects(instance.claimPair({ code: "invalid", name: "A" }));
    await assert.rejects(instance.claimPair({ code: "invalid", name: "A" }), error => error.status === 429);
  } finally { Date.now = now; }
  writeFileSync(path, "broken private content");
  assert.throws(() => new ChromeGateway(path));
  assert.equal(readFileSync(path, "utf8"), "broken private content");
});

test("unpair cancels queued and in-flight commands and late pairing/results", async () => {
  const { gateway: instance } = gateway();
  const device = await instance.claimPair({ code: instance.createPair("session-a").code, name: "A" });
  const first = instance.sendCommand("session-a", "first", {}, 2_000);
  const second = instance.sendCommand("session-a", "second", {}, 2_000);
  const rejected = [assert.rejects(first, /已取消/), assert.rejects(second, /已取消/)];
  const command = await instance.nextCommand(device.deviceId, device.token, {});
  const pair = instance.createPair("session-a");
  await instance.unpair("session-a");
  await Promise.all(rejected);
  assert.throws(() => instance.submitResult(device.deviceId, device.token, { id: command.id, ok: true }), /unknown/);
  await assert.rejects(instance.claimPair({ code: pair.code, name: "late" }), /invalid or expired/);
  assert.equal(instance.status("session-a").paired, false);
});

test("only a dequeued result is accepted; duplicate polls do not receive work", async () => {
  const { gateway: instance } = gateway();
  const device = await instance.claimPair({ code: instance.createPair("session-a").code, name: "A" });
  const poll = instance.nextCommand(device.deviceId, device.token, { extensionVersion: "0.15.58" });
  assert.equal(await instance.nextCommand(device.deviceId, device.token, {}), undefined);
  const result = instance.sendCommand("session-a", "first", {}, 2_000);
  const second = instance.sendCommand("session-a", "second", {}, 2_000);
  const command = await poll;
  const queued = instance.queues.get(device.deviceId)[0];
  assert.throws(() => instance.submitResult(device.deviceId, device.token, { id: queued.id, ok: true }), /unknown/);
  instance.submitResult(device.deviceId, device.token, { id: command.id, ok: true, result: 1 });
  assert.equal(await result, 1);
  assert.equal(instance.status("session-a").extensionVersion, "0.15.58");
  const next = await instance.nextCommand(device.deviceId, device.token, {});
  instance.submitResult(device.deviceId, device.token, { id: next.id, ok: true });
  await second;
});

test("failed persistence blocks all future authorizations and preserves old file", async () => {
  const { gateway: instance, path } = gateway();
  mkdirSync(path);
  const pair = instance.createPair("session-a");
  await assert.rejects(instance.claimPair({ code: pair.code, name: "A" }), error => error.status === 503);
  assert.throws(() => instance.status("session-a"), error => error.status === 503);
  assert.throws(() => instance.createPair("session-b"), error => error.status === 503);
});

test("abort removes queued work without exposing it to device", async () => {
  const { gateway: instance } = gateway();
  await instance.claimPair({ code: instance.createPair("session-a").code, name: "A" });
  const controller = new AbortController();
  const command = instance.sendCommand("session-a", "first", {}, 2_000, undefined, controller.signal);
  const rejected = assert.rejects(command, /aborted/);
  controller.abort();
  await rejected;
  assert.equal(instance.status("session-a").queuedCommands, 0);
  assert.equal(instance.status("session-a").pendingCommands, 0);
});

test("revoking a device removes every binding and rejects its work", async () => {
  const { gateway: instance } = gateway();
  const pairA = instance.createPair("session-a");
  const device = await instance.claimPair({ code: pairA.code, name: "Shared" });
  const pairB = instance.createPair("session-b");
  await instance.claimPair({ code: pairB.code, name: "Shared renamed", deviceId: device.deviceId, token: device.token });
  const pending = instance.sendCommand("session-a", "page.evaluate", {}, 2_000);
  const rejected = assert.rejects(pending, /revoked/);

  assert.equal(await instance.revokeBoundDevice("session-b"), true);
  await rejected;
  assert.equal(instance.status("session-a").paired, false);
  assert.throws(() => instance.authenticateDevice(device.deviceId, device.token), /invalid or revoked/);
  instance.close();
});
