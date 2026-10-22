let state;
const el = id => document.getElementById(id);
async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (response?.error) throw new Error(response.error);
  return response;
}
async function refresh() {
  state = await send("report-popup-status");
  el("origin").textContent = state.origin;
  el("trust").disabled = state.trusted;
  el("trust").textContent = state.trusted ? "当前站点已信任" : "信任当前站点（含 HTTP 风险确认）";
  el("request").hidden = !state.pending;
  el("session").textContent = state.pending ? `会话：${state.pending.sessionId}。请核对与网页一致后确认。` : "";
  el("status").textContent = state.pending ? "等待您确认连接。" : state.deviceId ? "已配对。在线状态请以网页为准。" : "信任后返回网页点击连接，再从此处确认。";
}
for (const [id, action] of [["trust", "report-trust"], ["approve", "report-approve"], ["forget", "report-forget"]]) {
  el(id).addEventListener("click", async () => {
    const buttons = document.querySelectorAll("button");
    buttons.forEach(button => { button.disabled = true; });
    try {
      await send(action, { origin: state?.origin, sessionId: state?.pending?.sessionId });
      await chrome.action.setBadgeText({ text: "" });
      await refresh();
    } catch (error) { el("status").textContent = error.message; }
    finally { el("approve").disabled = false; el("forget").disabled = false; el("trust").disabled = state?.trusted === true; }
  });
}
refresh().catch(error => { el("status").textContent = error.message; });
