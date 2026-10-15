import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import lockfile from "proper-lockfile";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { ChromeGateway, ChromeGatewayError } = await jiti.import("./chrome-gateway.ts");

function gateway() {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-chrome-gateway-"));
  const path = join(dir, "devices.json");
  return { gateway: new ChromeGateway(path), path };
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
