// Isolated layout fixture: real React markup/styles, no login, pairing or API requests.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { chromium } from "playwright";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: "export default new Proxy({}, { get: (_, key) => String(key) });" };
  },
});
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { LocalBrowser } = await jiti.import("./LocalBrowser.tsx");
const render = session => renderToStaticMarkup(React.createElement(LocalBrowser, { sessionId: session }));
const session = "01a162f2-631e-7468-9d06-33d318262f09";
assert.match(render(""), /请先回到对话页/);
assert.match(render(session), new RegExp(session));
const css = await Promise.all(["../../app/globals.css", "../../app/settings.css", "./LocalBrowser.module.css"].map(async path =>
  (await readFile(new URL(path, import.meta.url), "utf8")).replace(/:global\(([^)]+)\)/g, "$1")));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.setContent(`<html><body><main style="max-width:960px;margin:auto">${render(session)}</main></body></html>`);
  for (const content of css) await page.addStyleTag({ content });
  await page.addStyleTag({ content: "body { margin: 0; background: var(--bg-panel); color: var(--text); font-family: sans-serif; } *, *::before, *::after { box-sizing: border-box; }" });
  assert.equal(await page.getByRole("button", { name: "连接本机浏览器", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "撤销设备", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("link", { name: "下载 Chrome 扩展" }).getAttribute("href"), "/report-chrome-connector.zip");
  assert.equal(await page.locator("details[open]").count(), 0);
  for (const theme of ["rose", "light", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [960, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${width}: overflow`);
      const columns = await page.locator(".steps").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert.equal(columns, width > 640 ? 3 : 1);
      const padding = await page.locator(".panel").evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
      assert.ok(padding >= 16);
      if (theme === "rose" && width !== 320) {
        const path = join(tmpdir(), `report-local-browser-${width}.png`);
        await page.screenshot({ path, fullPage: true });
        console.log(`Screenshot: ${path}`);
      }
    }
  }
  const summary = page.getByText("查看详细安装步骤", { exact: true });
  await summary.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("details[open]").count(), 1);
  await page.getByText("安全与使用说明", { exact: true }).click();
  assert.equal(await page.locator("details[open]").count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log("PASS local-browser layout fixture: disabled states, download, keyboard disclosure, Rose/light/dark at 960/390/320px");
} finally { await browser.close(); }
