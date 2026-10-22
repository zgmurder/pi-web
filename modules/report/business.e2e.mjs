// Read-only acceptance against a running server; storageState contains secrets and must remain outside Git.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.PI_WEB_TEST_URL;
const storageState = process.env.PI_WEB_TEST_STORAGE_STATE;
if (!base || !storageState) throw new Error("Set PI_WEB_TEST_URL and PI_WEB_TEST_STORAGE_STATE");
const browser = await chromium.launch(process.env.PI_WEB_TEST_CHANNEL ? { channel: process.env.PI_WEB_TEST_CHANNEL } : {});
const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(130_000);
const errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (/\/api\/report\/business\/(tags\/packages|tags-v2\/alarms\/verify)/.test(request.url()) && request.method() !== "GET") writes.push(request.url());
});
try {
  await page.goto(`${base}/report/warnings`);
  await page.getByRole("button", { name: "查看第 1 条预警详情", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator('table[aria-label="预警记录"] tbody tr').count() > 0, true);
  console.log("PASS real warning list, detail and Escape dismissal");

  await page.goto(`${base}/report/analysis`);
  await page.getByRole("button", { name: "新增组合", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("textbox", { name: "搜索标签名称或路径", exact: true }).fill("不存在的验收标签");
  await page.getByText("未匹配到标签", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "生成专项报告（待接入）", exact: true }).isDisabled(), true);
  console.log("PASS package editor, catalog search and cancel without saving");

  await page.goto(`${base}/report/tagging`);
  await page.getByRole("heading", { name: "警情打标", exact: true }).waitFor();
  const collapse = page.getByRole("button", { name: "收起", exact: true });
  await collapse.click();
  await page.getByRole("button", { name: "展开", exact: true }).click();
  for (const path of ["analysis", "tagging", "warnings"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/report/${path}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, path);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log("PASS tagging filters, mobile layout; no script errors or business writes");
} finally { await context.close(); await browser.close(); }
