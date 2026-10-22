import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { safeLoginDestination } from "../../../lib/login-destination.ts";

const source = readFileSync(new URL("./LoginPage.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

async function submit(demoLogin, next, ok = true) {
  const redirects = [], requests = [];
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {}, URL, URLSearchParams,
    window: { location: { origin: "http://localhost", search: `?next=${encodeURIComponent(next)}`, replace: url => redirects.push(url) } },
    fetch: async (url, init) => { requests.push([url, init]); return { ok, status: ok ? 200 : 401 }; },
    require(name) {
      if (name === "react") return { useState: initial => [initial, () => {}], useSyncExternalStore: (_, snapshot) => snapshot() };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.endsWith("/useTheme")) return { useTheme() {} };
      if (name.endsWith("/login-destination")) return { safeLoginDestination };
      if (name.endsWith(".css")) return { default: {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  const tree = context.exports.ReportLoginPage({ backendLoginUrl: "http://report:8001/api/v1/auth/login", demoLogin });
  const form = tree.props.children.props.children[1];
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(requests[0][0], "/api/web-auth");
  assert.equal(requests[0][1].method, "POST");
  return { redirects, tree: JSON.stringify(tree) };
}

test("demo login ignores next and goes home; failed login never redirects", async () => {
  for (const next of ["/report/police?q=test", "//evil.example", "/login"]) {
    const view = await submit(true, next);
    assert.deepEqual(view.redirects, ["/"]);
    assert.match(view.tree, /演示模式/);
    assert.doesNotMatch(view.tree, /http:\/\/report:8001/);
  }
  assert.deepEqual((await submit(true, "/", false)).redirects, []);
});

test("normal login keeps safe destinations and real-backend diagnostics", async () => {
  const view = await submit(false, "/report/police?q=test");
  assert.deepEqual(view.redirects, ["http://localhost/report/police?q=test"]);
  assert.match(view.tree, /http:\/\/report:8001/);
  assert.doesNotMatch(view.tree, /演示模式/);
  for (const next of ["//evil.example", "/login"]) {
    assert.deepEqual((await submit(false, next)).redirects, ["/"]);
  }
});
