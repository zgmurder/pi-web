import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createLocalBrowserExtension } = await jiti.import("./extension.ts");
const { getChromeGateway, resetChromeGatewayForTests } = await jiti.import("./gateway.ts");

test("local browser tool requires UI approval, enforces read-only preset and routes only current session", async () => {
  const root = await mkdtemp(join(tmpdir(), "report-local-tool-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  resetChromeGatewayForTests();
  try {
    let tool;
    createLocalBrowserExtension().factory({ registerTool(value) { tool = value; } });
    const gateway = getChromeGateway();
    const device = await gateway.claimPair({ code: gateway.createPair("session-a").code, name: "Fixture" });
    gateway.noteDevice(device.deviceId, device.token, {});
    let entries = [];
    const ctx = { hasUI: true, ui: { confirm: async () => true }, sessionManager: { getSessionId: () => "session-a", getEntries: () => entries } };
    const execute = (args, context = ctx) => tool.execute("test", args, undefined, undefined, context);
    await assert.rejects(execute({ action: "tabs" }, { ...ctx, hasUI: false }), /未批准/);
    await assert.rejects(execute({ action: "snapshot" }, { ...ctx, ui: { confirm: async () => false } }), /未批准/);
    for (const url of ["file:///private", "https://user:password@example.test"]) await assert.rejects(execute({ action: "open", url }));
    await assert.rejects(execute({ action: "fill", text: "query" }), /uid/);
    entries = [{ type: "custom", customType: "pi-web:tool-selection", data: { version: 1, tools: ["read"] } }];
    await assert.rejects(execute({ action: "click", uid: "e1" }), /只读/);
    const pending = execute({ action: "snapshot", targetId: "1" });
    const command = await gateway.nextCommand(device.deviceId, device.token, {});
    assert.equal(command.params.sessionKey, "session-a");
    assert.equal(command.params.background, true);
    assert.equal(command.action, "page.snapshot");
    gateway.submitResult(device.deviceId, device.token, { id: command.id, ok: true, result: { text: "fixture" } });
    assert.match((await pending).content[0].text, /fixture/);
    await assert.rejects(execute({ action: "tabs" }, { ...ctx, sessionManager: { ...ctx.sessionManager, getSessionId: () => "session-b" } }), /未连接/);
    await assert.rejects(execute({ action: "tabs" }, { ...ctx, ui: { confirm: async () => { await gateway.unpair("session-a"); return true; } } }), /变更/);
  } finally {
    resetChromeGatewayForTests();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
