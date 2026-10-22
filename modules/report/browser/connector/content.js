(() => {
  if (window.__reportConnectorLoaded || window.top !== window) return;
  window.__reportConnectorLoaded = true;
  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "report-web") return;
    const { id, action, code, sessionId } = event.data;
    if (typeof id !== "string" || id.length > 80 || !["status", "pair"].includes(action)) return;
    try {
      // The worker checks the exact origin; content scripts cannot read device storage.
      const response = await chrome.runtime.sendMessage({ type: `report-${action}`, code, sessionId });
      window.postMessage({ source: "report-connector", id, response }, location.origin);
    } catch { window.postMessage({ source: "report-connector", id, response: { error: "扩展已更新或断开，请刷新页面。" } }, location.origin); }
  });
})();
