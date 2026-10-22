import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { reportApiOrigin } from "../api/policy.ts";

const source = readFileSync(new URL("../../../app/login/page.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const context = {
  exports: {}, URL, process,
  require(name) {
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
    if (name.endsWith("/LoginPage")) return { ReportLoginPage: "LoginPage" };
    if (name.endsWith("/policy")) return { reportApiOrigin };
    throw new Error(`Unexpected import: ${name}`);
  },
};
vm.runInNewContext(code, context);

test("login diagnostics use runtime backend configuration without disclosing invalid values", () => {
  const original = process.env.REPORT_API_URL;
  const originalDemo = process.env.REPORT_DEMO_LOGIN;
  try {
    delete process.env.REPORT_DEMO_LOGIN;
    assert.equal(context.exports.default().props.demoLogin, false);
    process.env.REPORT_DEMO_LOGIN = "true";
    assert.equal(context.exports.default().props.demoLogin, true);
    assert.equal(context.exports.dynamic, "force-dynamic");
    delete process.env.REPORT_API_URL;
    assert.equal(context.exports.default().props.backendLoginUrl, "http://127.0.0.1:8001/api/v1/auth/login");
    for (const origin of ["http://report:8001", "https://report.internal", "http://[::1]:8001/"]) {
      process.env.REPORT_API_URL = origin;
      assert.equal(context.exports.default().props.backendLoginUrl, new URL("/api/v1/auth/login", origin).href);
    }
    for (const invalid of ["http://admin:secret@report:8001", "http://report:8001/api/v1", "https://report?token=secret", "https://report/#secret", "not-a-url"]) {
      process.env.REPORT_API_URL = invalid;
      assert.equal(context.exports.default().props.backendLoginUrl, null);
    }
  } finally {
    if (original === undefined) delete process.env.REPORT_API_URL;
    else process.env.REPORT_API_URL = original;
    if (originalDemo === undefined) delete process.env.REPORT_DEMO_LOGIN;
    else process.env.REPORT_DEMO_LOGIN = originalDemo;
  }
});
