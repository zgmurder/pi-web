// Extension-origin IndexedDB is not shared with content scripts (which use the page's origin).
// Never fall back to chrome.storage.local for credentials when initialization fails.
const reportPrivateStore = {
  async transact(mode, operation) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("report-connector-private", 1);
      let abandoned = false;
      const timer = setTimeout(() => { abandoned = true; reject(new Error("连接器私有存储打开超时。")); }, 10_000);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = request.onblocked = () => { abandoned = true; clearTimeout(timer); reject(new Error("无法打开连接器私有存储，请关闭其他扩展窗口后重试。")); };
      request.onsuccess = () => { clearTimeout(timer); if (abandoned) request.result.close(); else resolve(request.result); };
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("state", mode);
        const timer = setTimeout(() => transaction.abort(), 10_000);
        let result;
        transaction.oncomplete = () => { clearTimeout(timer); resolve(result()); };
        transaction.onabort = transaction.onerror = () => { clearTimeout(timer); reject(new Error("连接器私有存储读写失败，已停止连接。")); };
        try { result = operation(transaction.objectStore("state")); }
        catch { transaction.abort(); }
      });
    } finally { db.close(); }
  },
  get(keys) {
    return this.transact("readonly", store => {
      const requests = (Array.isArray(keys) ? keys : [keys]).map(key => [key, store.get(key)]);
      return () => Object.fromEntries(requests.map(([key, request]) => [key, request.result]));
    });
  },
  set(values) {
    return this.transact("readwrite", store => {
      for (const [key, value] of Object.entries(values)) store.put(value, key);
      return () => undefined;
    });
  },
  remove(keys) {
    return this.transact("readwrite", store => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      return () => undefined;
    });
  },
};
let reportStorageInitialization;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- shared with importScripts consumers
function reportStorageReady() {
  if (!reportStorageInitialization) {
    reportStorageInitialization = (async () => {
      const keys = ["reportTrustedOrigin", "piChromeConnectorConfig"];
      const old = await chrome.storage.local.get(keys);
      const current = await reportPrivateStore.get(keys);
      const migrated = {};
      for (const key of keys) if (current[key] === undefined && old[key] !== undefined) migrated[key] = old[key];
      if (Object.keys(migrated).length) await reportPrivateStore.set(migrated);
      // Only authorize work after both the private commit and removal of old shared credentials.
      await chrome.storage.local.remove(keys);
    })().catch(() => {
      reportStorageInitialization = undefined;
      throw new Error("连接器凭证存储初始化失败，已停止连接。请重新检测；仍失败时重新加载扩展。");
    });
  }
  return reportStorageInitialization;
}
