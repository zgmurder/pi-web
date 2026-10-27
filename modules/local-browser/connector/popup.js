let state;
let busy = false;
const el = id => document.getElementById(id);
function buttons() {
  el("trust").disabled = busy || !state || state.trusted;
  el("approve").disabled = busy || !state?.pending;
  el("forget").disabled = busy;
  el("retry").disabled = busy;
}
async function send(type, fields = {}) {
  let timer;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type, ...fields }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("扩展后台响应超时，请重新检测；仍失败时到扩展管理页查看错误并重新加载。")), 25_000); }),
    ]);
    if (!response) throw new Error("扩展后台未返回状态，请到扩展管理页查看错误并重新加载。");
    if (response.error) throw new Error(response.error);
    return response;
  } finally { clearTimeout(timer); }
}
async function refresh() {
  state = undefined;
  el("origin").textContent = "正在检测当前站点…";
  state = await send("report-popup-status");
  el("origin").textContent = state.origin;
  el("trust").textContent = state.trusted ? "当前站点已信任" : "信任当前站点（含 HTTP 风险确认）";
  el("request").hidden = !state.pending;
  el("session").textContent = state.pending ? `会话：${state.pending.sessionId}。请核对与网页一致后确认。` : "";
  el("status").textContent = state.pending ? "等待您确认连接。" : state.deviceId ? "已配对。在线状态请以网页为准。" : "信任后返回网页点击连接，再从此处确认。";
}
async function run(action) {
  if (busy) return;
  busy = true;
  buttons();
  el("status").textContent = "正在处理，请稍候…";
  try {
    if (action) {
      await send(action, { origin: state?.origin, sessionId: state?.pending?.sessionId });
      await chrome.action.setBadgeText({ text: "" });
    }
    await refresh();
  } catch (error) {
    state = undefined;
    el("origin").textContent = "未能读取当前站点";
    el("request").hidden = true;
    el("status").textContent = `连接器初始化或操作失败：${error.message}`;
  } finally { busy = false; buttons(); }
}
for (const [id, action] of [["trust", "report-trust"], ["approve", "report-approve"], ["forget", "report-forget"], ["retry", undefined]]) {
  el(id).addEventListener("click", () => void run(action));
}
void run();
