/* Report integration; the browser control engine remains pi-chrome's service_worker.js. */
const REPORT_TRUST = "reportTrustedOrigin";
const REPORT_PENDING = "reportPendingPair";
const REPORT_CONFIG = "piChromeConnectorConfig";
let reportChanging = false;
// Do not expose device credentials to content-script contexts.
const reportStorageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

function reportOrigin(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("请选择警情分析助手的 HTTP(S) 页面。");
  return parsed.origin;
}
async function reportPublicStatus(origin) {
  const state = await chrome.storage.local.get([REPORT_TRUST, REPORT_CONFIG]);
  const config = state[REPORT_CONFIG];
  return { installed: true, trusted: state[REPORT_TRUST] === origin,
    deviceId: config?.bridgeUrl === `${origin}/api/chrome-gateway` ? config.deviceId : undefined };
}
async function reportMessage(message, sender) {
  await reportStorageReady;
  const popup = !sender.tab && sender.url === chrome.runtime.getURL("popup.html");
  if (popup) {
    if (message.type === "report-popup-status") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const origin = reportOrigin(tab?.url || "");
      const pending = (await chrome.storage.session.get(REPORT_PENDING))[REPORT_PENDING];
      return { ...await reportPublicStatus(origin), origin, tabId: tab.id,
        pending: pending?.origin === origin && pending.expiresAt > Date.now() ? { sessionId: pending.sessionId, expiresAt: pending.expiresAt } : null };
    }
    if (message.type === "report-trust") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const origin = reportOrigin(tab?.url || "");
      // Recheck the exact origin displayed by the popup, rather than trusting a changed active tab.
      if (origin !== message.origin) throw new Error("页面已切换，请重新打开扩展。");
      const previous = (await chrome.storage.local.get(REPORT_TRUST))[REPORT_TRUST];
      if (previous && previous !== origin) throw new Error("已信任其他站点，请先停止并忘记原站点。");
      await chrome.scripting.unregisterContentScripts({ ids: ["report-page"] }).catch(() => {});
      await chrome.storage.local.set({ [REPORT_TRUST]: origin });
      // Match patterns cannot constrain ports: the content script and worker both recheck exact origin.
      await chrome.scripting.registerContentScripts([{ id: "report-page", matches: [`${new URL(origin).protocol}//${new URL(origin).hostname}/*`], js: ["content.js"], runAt: "document_idle", allFrames: false }]);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return { ok: true };
    }
    if (message.type === "report-forget") {
      await chrome.storage.local.remove([REPORT_TRUST, REPORT_CONFIG]);
      await chrome.storage.session.remove(REPORT_PENDING);
      await chrome.scripting.unregisterContentScripts({ ids: ["report-page"] }).catch(() => {});
      reportConfigChanged();
      return { ok: true };
    }
    if (message.type === "report-approve") {
      const pending = (await chrome.storage.session.get(REPORT_PENDING))[REPORT_PENDING];
      await chrome.storage.session.remove(REPORT_PENDING);
      if (!pending || pending.expiresAt <= Date.now() || pending.sessionId !== message.sessionId || pending.origin !== message.origin) throw new Error("连接请求已过期或变更，请回到网页重新连接。");
      const state = await chrome.storage.local.get([REPORT_TRUST, REPORT_CONFIG]);
      if (state[REPORT_TRUST] !== pending.origin) throw new Error("站点未授权。");
      const tab = await chrome.tabs.get(pending.tabId);
      if (reportOrigin(tab.url) !== pending.origin) throw new Error("发起连接的页面已离开站点。");
      const bridgeUrl = `${pending.origin}/api/chrome-gateway`;
      const old = state[REPORT_CONFIG];
      const existing = old?.bridgeUrl === bridgeUrl && old.deviceId && old.token;
      const response = await fetch(`${bridgeUrl}/pair/claim`, { method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ code: pending.code, name: "本机 Chrome", ...(existing ? { deviceId: old.deviceId, token: old.token } : {}) }) });
      if (!response.ok) throw new Error(`配对失败（${response.status}）；如已撤销设备，请先忘记站点，再重新授权。`);
      const result = await response.json();
      const token = result.token || (existing ? old.token : "");
      if (result.sessionId !== pending.sessionId || typeof result.deviceId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("配对响应无效。");
      await chrome.storage.local.set({ [REPORT_CONFIG]: { mode: "gateway", bridgeUrl, deviceId: result.deviceId, token, allowInsecureHttp: pending.origin.startsWith("http:") } });
      reportConfigChanged();
      return { ok: true };
    }
    throw new Error("不支持的扩展操作。");
  }
  if (!sender.tab || sender.frameId !== 0) throw new Error("仅允许已授权站点的主页面。");
  const origin = reportOrigin(sender.url);
  if ((await chrome.storage.local.get(REPORT_TRUST))[REPORT_TRUST] !== origin) throw new Error("请从扩展图标授权当前站点。");
  if (message.type === "report-status") return reportPublicStatus(origin);
  if (message.type === "report-pair") {
    if (typeof message.code !== "string" || !/^[A-Z2-9-]{33}$/.test(message.code) || !/^[a-zA-Z0-9-]{1,80}$/.test(message.sessionId)) throw new Error("无效连接请求。");
    await chrome.storage.session.set({ [REPORT_PENDING]: { origin, tabId: sender.tab.id, sessionId: message.sessionId, code: message.code, expiresAt: Date.now() + 120_000 } });
    await chrome.action.setBadgeText({ text: "确认" });
    return { pending: true };
  }
  throw new Error("网页无权执行此操作。");
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type?.startsWith("report-")) return;
  if (reportChanging) { reply({ error: "扩展正在处理请求，请稍后重试。" }); return; }
  reportChanging = true;
  reportMessage(message, sender).then(reply, error => reply({ error: error.message || "连接失败。" })).finally(() => { reportChanging = false; });
  return true;
});
