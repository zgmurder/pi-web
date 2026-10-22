import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./SessionControls.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

function mount() {
  const states = [], effects = [], listeners = new Map(), requests = [], redirects = [];
  let cursor = 0, mounted = false, response = { authenticated: true, user: { id: 1, username: "张三" } }, deleteOk = false, resolveDelete;
  const inside = {};
  const account = { open: false, contains: target => target === inside, querySelector: () => ({ focus: () => { account.focused = true; } }) };
  const listen = (type, fn) => listeners.set(type, fn);
  const unlisten = type => listeners.delete(type);
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {}, AbortController,
    document: { hidden: false, addEventListener: listen, removeEventListener: unlisten },
    window: { location: { pathname: "/report/police", search: "?q=1", replace: url => redirects.push(url) }, setInterval: () => 1, clearInterval() {}, addEventListener: listen, removeEventListener: unlisten },
    fetch: async (url, options) => {
      requests.push([url, options]);
      if (options.method === "DELETE") return new Promise(resolve => { resolveDelete = () => resolve({ ok: deleteOk }); });
      return { ok: true, json: async () => response };
    },
    require: name => {
      if (name === "react") return {
        useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
        useRef: () => ({ current: account }),
        useEffect: fn => { if (!mounted) effects.push(fn); },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.endsWith(".css")) return { default: {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  const render = () => { cursor = 0; return context.exports.SessionControls(); };
  render();
  mounted = true;
  const cleanup = effects.map(fn => fn());
  return { render, account, inside, listeners, requests, redirects,
    status: value => { response = value; },
    finishLogout: ok => { deleteOk = ok; resolveDelete(); },
    cleanup: () => cleanup.forEach(fn => fn?.()),
  };
}
const summary = tree => tree.props.children[0];
const dropdown = tree => tree.props.children[1];
const logout = tree => dropdown(tree).props.children[0];

test("user disclosure reuses auth status and supports outside, Escape and focus dismissal", async () => {
  const view = mount();
  assert.equal(summary(view.render()).props.title, "用户信息");
  await tick();
  assert.equal(summary(view.render()).props.title, "张三");
  assert.equal(view.render().type, "details");
  assert.equal(summary(view.render()).type, "summary");
  assert.equal(view.account.open, false);
  assert.equal(view.requests.length, 1);
  view.account.open = true;
  view.listeners.get("pointerdown")({ target: view.inside });
  assert.equal(view.account.open, true);
  view.listeners.get("pointerdown")({ target: {} });
  assert.equal(view.account.open, false);
  view.account.open = true;
  let stopped = false;
  view.listeners.get("keydown")({ key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(view.account.open, false);
  assert.equal(view.account.focused, true);
  assert.equal(stopped, true);
  view.account.open = true;
  view.render().props.onBlur({ currentTarget: view.account, relatedTarget: view.inside });
  assert.equal(view.account.open, true);
  view.render().props.onBlur({ currentTarget: view.account, relatedTarget: null });
  assert.equal(view.account.open, false);
  view.cleanup();
  assert.equal(view.listeners.size, 0);
});

test("logout remains explicit, disables while pending, reports failure and permits retry", async () => {
  const view = mount();
  await tick();
  logout(view.render()).props.onClick();
  assert.equal(logout(view.render()).props.disabled, true);
  assert.equal(logout(view.render()).props.children, "退出中…");
  view.finishLogout(false);
  await tick();
  assert.equal(logout(view.render()).props.disabled, false);
  assert.equal(dropdown(view.render()).props.children[1].props.role, "alert");
  assert.equal(view.redirects.length, 0);
  logout(view.render()).props.onClick();
  view.finishLogout(true);
  await tick();
  assert.deepEqual(view.redirects, ["/login"]);
  assert.equal(view.requests.filter(([, options]) => options.method === "DELETE").length, 2);
  view.cleanup();
});

test("session rechecks update the displayed user and preserve expired-session redirects", async () => {
  const view = mount();
  await tick();
  view.status({ authenticated: true, user: { username: "李四" } });
  await view.listeners.get("focus")();
  assert.equal(summary(view.render()).props.title, "李四");
  view.status({ authenticated: false });
  await view.listeners.get("focus")();
  assert.deepEqual(view.redirects, ["/login?next=%2Freport%2Fpolice%3Fq%3D1"]);
  view.cleanup();
});
