import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cacheSessionPath } = await jiti.import("../../lib/session-reader.ts");
const { GET, POST } = await jiti.import("../../app/api/local-browser/route.ts");
const { getChromeGateway, resetChromeGatewayForTests } = await jiti.import("./gateway.ts");

test("management validates source and saved session; cancels pairing, disconnects and revokes", async () => {
  const root = await mkdtemp(join(tmpdir(), "report-browser-manage-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  resetChromeGatewayForTests();
  const sessionId = randomUUID(), path = join(root, "session.jsonl");
  await writeFile(path, JSON.stringify({ type: "session", version: 3, id: sessionId, cwd: root }) + "\n");
  cacheSessionPath(sessionId, path);
  const request = (action, overrides = {}) => new Request("http://localhost:30142/api/local-browser", { method: "POST", headers: { host: "localhost:30142", origin: "http://localhost:30142", "content-type": "application/json" }, body: JSON.stringify({ sessionId, action, ...overrides }) });
  const status = () => GET(new Request(`http://localhost:30142/api/local-browser?sessionId=${sessionId}`, { headers: { host: "localhost:30142" } }));
  try {
    const cross = request("pair"); cross.headers.set("origin", "https://evil.test");
    assert.equal((await POST(cross)).status, 403);
    assert.equal((await POST(request("pair", { sessionId: "invalid" }))).status, 400);
    const pair = await (await POST(request("pair"))).json();
    assert.ok(pair.code);
    assert.equal((await POST(request("cancel"))).status, 200);
    const gateway = getChromeGateway();
    await assert.rejects(gateway.claimPair({ code: pair.code, name: "A" }));
    const bind = async () => {
      const next = await (await POST(request("pair"))).json();
      return gateway.claimPair({ code: next.code, name: "A" });
    };
    await bind();
    assert.equal((await (await status()).json()).paired, true);
    assert.equal((await POST(request("disconnect"))).status, 200);
    assert.equal((await (await status()).json()).paired, false);
    const device = await bind();
    assert.equal((await POST(request("revoke"))).status, 200);
    assert.throws(() => gateway.authenticateDevice(device.deviceId, device.token));
    assert.equal((await POST(request("unsupported"))).status, 400);
    await rm(path);
    assert.equal((await POST(request("pair"))).status, 404);
  } finally {
    resetChromeGatewayForTests();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
