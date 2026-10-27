import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { deviceRequest, readBody } = await jiti.import("./http.ts");
const { getChromeGateway, resetChromeGatewayForTests } = await jiti.import("./gateway.ts");
const origin = `chrome-extension://${"a".repeat(32)}`;
const request = (path, body, headers = {}) => new Request(`http://127.0.0.1:30142/api/chrome-gateway/${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { host: "127.0.0.1:30142", origin, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("device routes enforce capability/token and CORS on HTTP without Fetch Metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "report-device-http-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  resetChromeGatewayForTests();
  try {
    const gateway = getChromeGateway();
    assert.equal((await deviceRequest(request("device/next?deviceId=none"))).status, 401);
    assert.equal((await deviceRequest(request("pair/claim", { code: "bad", name: "A" }))).status, 404);
    assert.equal((await deviceRequest(request("pair/claim", {}, { origin: "https://evil.test" }))).status, 403);
    assert.equal((await deviceRequest(request("pair/claim", {}, { "content-type": "text/plain" }))).status, 415);
    assert.equal((await deviceRequest(request("pair/claim", { data: "x".repeat(17000) }))).status, 413);
    const pair = gateway.createPair("session-a");
    const claim = await deviceRequest(request("pair/claim", { code: pair.code, name: "A" }));
    assert.equal(claim.status, 200);
    assert.equal(claim.headers.get("access-control-allow-origin"), origin);
    assert.equal(claim.headers.get("cache-control"), "no-store");
    const device = await claim.json();
    const auth = { authorization: `Bearer ${device.token}` };
    const result = gateway.sendCommand("session-a", "tab.list", {}, 2000);
    const next = await deviceRequest(request(`device/next?deviceId=${device.deviceId}&version=0.15.58`, undefined, auth));
    const command = await next.json();
    assert.equal(next.status, 200);
    assert.equal((await deviceRequest(request("device/result", { deviceId: device.deviceId, id: command.id, ok: true, result: ["fixture"] }, auth))).status, 200);
    assert.deepEqual(await result, ["fixture"]);
    assert.equal((await deviceRequest(request("device/result", { deviceId: device.deviceId, id: command.id, ok: true }, auth))).status, 404);
    await gateway.revokeBoundDevice("session-a");
    assert.equal((await deviceRequest(request(`device/next?deviceId=${device.deviceId}`, undefined, auth))).status, 401);
    const options = new Request("http://127.0.0.1/api/chrome-gateway/device/result", { method: "OPTIONS", headers: { host: "127.0.0.1", origin } });
    assert.equal((await deviceRequest(options)).status, 204);
  } finally {
    resetChromeGatewayForTests();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("body validation rejects malformed/array JSON and bounds streamed bytes", async () => {
  for (const body of ["null", "[]", "broken"]) await assert.rejects(readBody(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body })));
  await assert.rejects(readBody(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: '"中文"' }), 5), error => error.status === 413);
});
