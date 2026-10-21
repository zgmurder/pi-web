import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { execFileSync } from "node:child_process";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });

test("instance boundary covers selection, creation, old grants, files and session restoration", async (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-instance-")));
  const root = path.join(base, "app");
  const outside = path.join(base, "app-other");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(root, "project"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
  const previous = { root: process.env.PI_WEB_INSTANCE_ROOT, agent: process.env.PI_CODING_AGENT_DIR };
  process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
  fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
  delete process.env.PI_WEB_INSTANCE_ROOT;
  t.after(() => {
    for (const [key, value] of [["PI_WEB_INSTANCE_ROOT", previous.root], ["PI_CODING_AGENT_DIR", previous.agent]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(base, { recursive: true, force: true });
  });

  const boundary = await jiti.import("./instance-root.ts");
  const browser = await jiti.import("./directory-browser.ts");
  const access = await jiti.import("./file-access.ts");
  const defaults = await jiti.import("./default-cwd.ts");
  assert.equal(boundary.isInstancePathAllowed(outside), true);
  assert.equal(browser.getBrowseStartDirectory(), os.homedir());
  access.allowFileRoot(outside);
  globalThis.__piAllowedRootsCache = { roots: new Set([outside]), expiresAt: Date.now() + 60_000 };
  process.env.PI_WEB_INSTANCE_ROOT = root;

  await t.test("canonical and missing paths stay inside, without prefix or dot-dot escapes", async () => {
    assert.equal(boundary.isInstancePathAllowed(root), true);
    assert.equal(boundary.isInstancePathAllowed(outside), false);
    assert.equal(boundary.isInstancePathAllowed(path.parse(root).root), false);
    assert.equal(boundary.isInstancePathAllowed(`${root}/project/../project`), false);
    assert.equal(boundary.isInstancePathAllowed(path.join(root, "missing", "new"), true), true);
    assert.equal(boundary.isInstancePathAllowed(path.join(root, "missing")), false);
    assert.equal(browser.getBrowseStartDirectory(), root);
    assert.equal(browser.getParentDirectory(root), null);
    assert.equal(browser.shouldShowWindowsDrivePicker(undefined, "win32"), false);
    assert.equal(browser.normalizeDirectory("~/project"), path.join(root, "project"));
    assert.equal(defaults.defaultCwdPath(new Date(2026, 0, 2)), path.join(root, "workspace", "20260102"));
    assert.deepEqual(await access.getAllowedFileRoots(), new Set([root]));
    assert.equal(access.isFilePathAllowed(outside, new Set([outside])), false);
  });

  const { NextRequest } = await jiti.import("next/server");
  const browse = await jiti.import("../app/api/cwd/browse/route.ts");
  const validate = await jiti.import("../app/api/cwd/validate/route.ts");
  const defaultRoute = await jiti.import("../app/api/default-cwd/route.ts");
  const files = await jiti.import("../app/api/files/[...path]/route.ts");
  const { encodeFilePathForApi } = await jiti.import("./file-paths.ts");
  const jsonRequest = (url, body) => new NextRequest(`http://localhost${url}`, {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const fileRequest = (target, type, body) => {
    const encoded = encodeFilePathForApi(target);
    const url = `/api/files/${encoded}?type=${type}&sessionId=old-session`;
    return (body ? files.POST : files.GET)(
      body ? jsonRequest(url, body) : new NextRequest(`http://localhost${url}`),
      { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) },
    );
  };

  await t.test("API requests cannot browse, select, create, or read outside", async () => {
    const initial = await browse.GET(new NextRequest("http://localhost/api/cwd/browse"));
    assert.equal(initial.status, 200);
    assert.equal((await initial.json()).parentPath, null);
    for (const target of [outside, path.parse(root).root, `${root}/project/../project`]) {
      const response = await browse.GET(new NextRequest(`http://localhost/api/cwd/browse?path=${encodeURIComponent(target)}`));
      assert.equal(response.status, 403, `${target}: ${JSON.stringify(await response.json())}`);
      assert.equal((await validate.POST(jsonRequest("/api/cwd/validate", { cwd: target }))).status, 403);
    }
    assert.equal((await browse.POST(jsonRequest("/api/cwd/browse", { path: outside, name: "new" }))).status, 403);
    assert.equal(fs.existsSync(path.join(outside, "new")), false);
    assert.equal((await browse.POST(jsonRequest("/api/cwd/browse", { path: root, name: "new" }))).status, 200);
    assert.equal((await validate.POST(jsonRequest("/api/cwd/validate", { cwd: root }))).status, 200);
    assert.equal((await defaultRoute.POST()).status, 200);
    for (const type of ["list", "read", "download", "preview", "meta", "watch"]) {
      assert.equal((await fileRequest(path.join(outside, "secret.txt"), type)).status, 403);
    }
    assert.equal((await fileRequest(outside, "upload-check", { fileNames: ["new.txt"] })).status, 403);
  });

  await t.test("external and dangling links cannot be selected, approved, or used to create files", async () => {
    const link = path.join(root, "external");
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    fs.symlinkSync(path.join(outside, "missing"), path.join(root, "dangling"), process.platform === "win32" ? "junction" : "dir");
    const insideLink = path.join(root, "alias");
    fs.symlinkSync(path.join(root, "project"), insideLink, process.platform === "win32" ? "junction" : "dir");
    assert.equal(boundary.isInstancePathAllowed(insideLink), true);
    assert.equal(boundary.isInstancePathAllowed(link), false);
    assert.equal(boundary.isInstancePathAllowed(path.join(root, "dangling", "new"), true), false);
    assert.equal((await browser.listDirectories(root)).some((entry) => entry.name === "external"), false);
    await assert.rejects(browser.createDirectory(link, "new"), /Access denied/);
    assert.equal((await fileRequest(link, "allow-link", { target: outside })).status, 403);
    assert.equal((await fileRequest(link, "upload-check", { fileNames: ["new.txt"] })).status, 403);
    fs.renameSync(path.join(root, "workspace"), path.join(root, "old-workspace"));
    fs.symlinkSync(outside, path.join(root, "workspace"), process.platform === "win32" ? "junction" : "dir");
    assert.equal((await defaultRoute.POST()).status, 403);
    assert.deepEqual(fs.readdirSync(outside), ["secret.txt"]);
  });

  await t.test("worktrees cannot create a sibling outside the instance or remove an external target", async () => {
    execFileSync("git", ["init", root], { stdio: "ignore" });
    const worktrees = await jiti.import("./worktree.ts");
    await assert.rejects(worktrees.addWorktree(root, "feature"), /Access denied/);
    assert.equal(fs.existsSync(`${root}-worktrees`), false);
    await assert.rejects(worktrees.removeWorktree(root, outside, true), /Access denied/);
    assert.equal(fs.existsSync(outside), true);
  });

  await t.test("new and persisted outside sessions are refused before runtime loading", async () => {
    const { startRpcSession } = await jiti.import("./rpc-manager.ts");
    await assert.rejects(startRpcSession("__new__outside", "", outside), /Access denied/);
    const sessionFile = path.join(base, "old-session.jsonl");
    fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id: "old-session", timestamp: new Date().toISOString(), cwd: outside }) + "\n");
    await assert.rejects(startRpcSession("old-session", sessionFile), /Access denied/);
    const agent = await jiti.import("../app/api/agent/new/route.ts");
    const response = await agent.POST(jsonRequest("/api/agent/new", { cwd: outside, type: "prompt", message: "hello" }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).accepted, false);
  });
});
