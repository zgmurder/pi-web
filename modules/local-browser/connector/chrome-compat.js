// Use the Chrome 109 callback contract instead of relying on Promise overload availability.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- shared with the importing service worker
function reportDebuggerCall(method, ...args) {
  return new Promise((resolve, reject) => {
    chrome.debugger[method](...args, result => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message || "Chrome debugger operation failed"));
      else resolve(result);
    });
  });
}
