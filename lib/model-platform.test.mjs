import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("platform credentials, instance isolation, schema and query contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-platform-"));
  const previous = process.env.PI_CODING_AGENT_DIR; const fetch = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const jiti = createJiti(import.meta.url);
    const p = await jiti.import("./model-platform.ts");
    const q = await jiti.import("./model-platform-query.ts");
    const draft = { authType: "apiKey", enabled: true, apiUrl: "http://127.0.0.1:9300", webUrl: "http://127.0.0.1:5180", apiKey: "test-only-secret" };
    await p.savePlatform(draft);
    assert.equal(JSON.stringify(p.publicPlatformConfig()).includes(draft.apiKey), false);
    assert.equal(p.platformDraft({ ...draft, apiKey: undefined }).apiKey, draft.apiKey);
    assert.equal(p.platformDraft({ ...draft, apiUrl: "http://127.0.0.1:9301", apiKey: undefined }).apiKey, "");
    for (const origin of ["http://192.168.1.20:9300", "http://10.0.0.5:9300", "http://model.internal:9300", "https://model.example"]) {
      assert.equal(p.platformDraft({ ...draft, apiUrl: origin, webUrl: origin }).apiUrl, origin);
    }
    for (const origin of ["ftp://model.internal", "http://user:password@model.internal", "http://model.internal/api", "http://model.internal?token=x", "http://model.internal/#fragment"]) {
      assert.throws(() => p.platformDraft({ ...draft, apiUrl: origin }));
    }
    let sentSql;
    globalThis.fetch = async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["X-API-Key"], draft.apiKey);
      if (url.endsWith("/datasources")) return Response.json([{ id: 1, name: "Test", source_type: "database", config: { password: "do-not-forward", db_type: "mysql" }, description: "Business rules" }]);
      if (url.endsWith("/tables")) return Response.json({ tables: [{ name: "events", comment: "Events" }] });
      if (url.endsWith("/query")) { sentSql = JSON.parse(options.body).sql; return Response.json({ columns: ["total"], rows: [[3]], truncated: false, fetchedAt: "2026-01-01T00:00:00Z" }); }
      throw new Error("unexpected request");
    };
    const [source] = await p.platformSources();
    assert.equal(JSON.stringify(source).includes("do-not-forward"), false);
    assert.equal((await q.queryPlatform(source.id, {})).capabilities.templatesRequired, false);
    assert.equal((await q.queryPlatform(source.id, { action: "schema" })).rows[0].name, "events");
    const result = await q.queryPlatform(source.id, { action: "sql", sql: "SELECT COUNT(*) AS total FROM events WHERE ts >= :start AND ts < :end", start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" });
    assert.deepEqual(result.rows, [[3]]); assert.match(sentSql, /2026-01-01 08:00:00/);
    await assert.rejects(q.queryPlatform(source.id, { action: "sql", sql: "DELETE FROM events" }));
    globalThis.fetch = async () => new Response("secret error", { status: 401 });
    await assert.rejects(p.platformSources(), e => e.message.includes("401") && !e.message.includes("secret error"));
    assert.equal(p.platformDraft({ ...draft, authType: "bearer", apiKey: undefined }).apiKey, "");
    const bearer = p.platformDraft({ ...draft, authType: "bearer", apiKey: "Bearer test-login-token" });
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer test-login-token");
      assert.equal(options.headers["X-API-Key"], undefined);
      return Response.json([]);
    };
    await p.platformSources(bearer);
    await p.savePlatform({ ...draft, authType: "bearer", apiKey: "test-login-token" });
    assert.equal(p.publicPlatformConfig().authType, "bearer");
    assert.equal(JSON.stringify(p.publicPlatformConfig()).includes("test-login-token"), false);
    for (const status of [403, 404, 500]) {
      globalThis.fetch = async () => new Response("secret error", { status });
      await assert.rejects(p.platformSources(), e => e.message.includes(String(status)) && !e.message.includes("secret error"));
    }
    await p.savePlatform({ ...draft, apiUrl: "http://127.0.0.1:9301", apiKey: undefined });
    assert.throws(() => p.selectedPlatform(source.id), /unavailable/);
    await writeFile(join(root, "pi-web-model-platform.json"), "broken");
    await assert.rejects(p.savePlatform(draft), /configuration/);
  } finally {
    globalThis.fetch = fetch;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
