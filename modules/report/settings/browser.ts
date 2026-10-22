import { spawn } from "node:child_process";
import { serializeByKey } from "@/lib/key-serializer";
import { getSystem, SystemError } from "./systems";

// Credentials travel over stdin, never argv, stdout, tool arguments or a script file.
const connector = String.raw`
import json, sys
from urllib.request import build_opener, ProxyHandler
try:
    from DrissionPage import Chromium, ChromiumOptions
    data = json.load(sys.stdin)
    with build_opener(ProxyHandler({})).open('http://127.0.0.1:%s/json/version' % data['port'], timeout=5) as response:
        version = json.load(response)
    options = ChromiumOptions().set_local_port(data['port']).existing_only()
    options.headless('HeadlessChrome' in version.get('User-Agent', ''))
    browser = Chromium(options)
    tab = browser.new_tab(data['url'])
    if data['action'] == 'login':
        tab.wait.doc_loaded()
        script = r"""
const d = arguments[0];
if (location.origin !== new URL(d.url).origin) return false;
const u = document.querySelector(d.usernameSelector);
const p = document.querySelector(d.passwordSelector);
const b = document.querySelector(d.submitSelector);
if (!(u instanceof HTMLInputElement) || !(p instanceof HTMLInputElement) || p.type !== 'password' || !b) return false;
if (![u,p,b].every(e => e.getClientRects().length && !e.disabled)) return false;
if (b.tagName === 'A') return false;
const form = p.form;
if (form && (u.form !== form || b.form !== form || new URL(b.hasAttribute('formaction') ? b.formAction : form.action || location.href).origin !== location.origin)) return false;
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(u, d.username); setter.call(p, d.password);
u.dispatchEvent(new Event('input', {bubbles:true}));
p.dispatchEvent(new Event('input', {bubbles:true}));
u.dispatchEvent(new Event('change', {bubbles:true}));
p.dispatchEvent(new Event('change', {bubbles:true}));
if (location.origin !== new URL(d.url).origin) return false;
b.click();
return true;
"""
        if not tab.run_js(script, data):
            raise ValueError('login refused')
    print(json.dumps({'ok': True, 'tabId': str(tab.tab_id)}))
except BaseException:
    print(json.dumps({'ok': False}))
    sys.exit(1)
`;

export async function testBrowser(port: number, signal?: AbortSignal) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SystemError("浏览器端口不正确。");
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      redirect: "error", cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString("utf8");
        if (text.length > 16384) throw new Error();
      }
    } finally { await reader.cancel(); }
    const data = JSON.parse(text);
    if (typeof data.Browser !== "string" || typeof data.webSocketDebuggerUrl !== "string") throw new Error();
    return { message: "本机 Chrome 调试连接正常。" };
  } catch { throw new SystemError("无法连接本机 Chrome；请启动专用浏览器并检查调试端口（默认 9333）。"); }
}

export async function openSystem(id: string, action: "open" | "login", signal?: AbortSignal) {
  const initial = getSystem(id);
  return serializeByKey(Symbol.for("report:browser"), String(initial.port), async () => {
    signal?.throwIfAborted();
    const system = getSystem(id);
    if (system.port !== initial.port) throw new SystemError("浏览器配置已改变，请重试。");
    if (action === "login" && (!system.username || !system.password || !system.usernameSelector || !system.passwordSelector || !system.submitSelector)) {
      throw new SystemError("请先保存账号、密码及三个登录表单 CSS 定位，或使用“打开系统”后人工登录。");
    }
    await testBrowser(system.port, signal);
    return new Promise<{ message: string; port: number; tabId: string }>((resolve, reject) => {
      const child = spawn(process.env.REPORT_BROWSER_PYTHON || "python", ["-c", connector], {
        windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      let output = "";
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true; cleanup(); child.kill();
        reject(new SystemError("浏览器操作失败或超时。请检查 Python/DrissionPage、同源登录网址和 CSS 定位；不要在对话中发送密码。"));
      };
      const timer = setTimeout(fail, 30000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", fail); };
      signal?.addEventListener("abort", fail, { once: true });
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.stdout.on("data", chunk => { output += chunk.toString(); if (output.length > 4096) fail(); });
      child.on("close", code => {
        if (settled) return;
        try {
          const result = JSON.parse(output);
          if (code !== 0 || result.ok !== true || typeof result.tabId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(result.tabId)) throw new Error();
          settled = true; cleanup();
          resolve({ message: action === "login" ? "已提交登录表单；不代表登录成功，请检查页面并完成人工验证。" : "已在服务端浏览器打开系统；可人工登录后继续查询。", port: system.port, tabId: result.tabId });
        } catch { fail(); }
      });
      child.stdin.end(JSON.stringify({ ...system, password: action === "login" ? system.password : "", action }));
      if (signal?.aborted) fail();
    });
  });
}
