import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("scopes Next.js output file tracing to the pi-web package", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

  assert.equal(config.outputFileTracingRoot, projectRoot);
});

test("uses a practical no-cap proxy body size without disabling the authentication proxy", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });
  assert.equal(config.experimental.proxyClientMaxBodySize, Number.MAX_SAFE_INTEGER);
});

test("the Nginx deployment template disables its request body size cap", () => {
  const template = readFileSync(new URL("../deploy/linux/nginx.conf.example", import.meta.url), "utf8");
  assert.match(template, /^\s*client_max_body_size 0;/m);
});
