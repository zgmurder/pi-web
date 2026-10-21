import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const launcher = new URL("../bin/pi-web.js", import.meta.url);

test("launcher pins the canonical package root regardless of inherited cwd or root override", () => {
  const pkgDir = fs.realpathSync(process.cwd());
  let spawned;
  const dependencies = {
    "./node-version": { isNodeVersionSupported: () => true },
    child_process: { spawn: (...args) => { spawned = args; return { pid: 123, stdout: { on() {} } }; } },
    fs: { realpathSync: fs.realpathSync, existsSync: () => true },
    path,
    "./pi-web-options": { parseCommandLine: () => ({ command: "start", port: "0", hostname: "127.0.0.1", openBrowser: false }) },
    "./pi-web-node-args": { getNextNodeArgs: (bin, args) => [bin, ...args] },
    "./process-lifecycle": { wireChildProcessLifecycle() {} },
    "./rotate-preview-secrets": { rotatePreviewSecrets: () => ({ ok: true }) },
    "./browser-opener": {},
    "./run-records": { createRunRecordTracker: () => ({}), getOpenUrl: () => "http://localhost" },
    "./pi-web-commands": { getPackageVersion: () => "test" },
  };
  const fakeRequire = (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  };
  fakeRequire.resolve = require.resolve;
  vm.runInNewContext(fs.readFileSync(launcher, "utf8"), {
    require: fakeRequire, __dirname: path.join(pkgDir, "bin"), console,
    process: { versions: process.versions, execPath: process.execPath, env: { PI_WEB_INSTANCE_ROOT: path.parse(pkgDir).root } },
  });
  assert.equal(spawned[2].cwd, pkgDir);
  assert.equal(spawned[2].env.PI_WEB_INSTANCE_ROOT, pkgDir);
});
