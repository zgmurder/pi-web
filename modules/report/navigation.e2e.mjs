// Run against an existing development server: PI_WEB_TEST_URL=http://127.0.0.1:30142 node modules/report/navigation.e2e.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.PI_WEB_TEST_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch(process.env.PI_WEB_TEST_CHANNEL ? { channel: process.env.PI_WEB_TEST_CHANNEL } : {});
if (!process.env.PI_WEB_TEST_STORAGE_STATE) {
  await browser.close();
  throw new Error("整站已启用 Report 登录：请通过 PI_WEB_TEST_STORAGE_STATE 提供已登录的 Playwright storageState 文件（不得提交到 Git）。");
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: process.env.PI_WEB_TEST_STORAGE_STATE });
await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
const mutations = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
});
page.on("request", (request) => {
  const path = new URL(request.url()).pathname;
  if (path === "/api/agent/new" || (request.method() === "POST" && /^\/api\/agent\/[^/]+$/.test(path) && ["prompt", "steer", "follow_up", "fork", "new_session"].includes(request.postDataJSON()?.type))) {
    mutations.push(path);
  }
});
const nav = () => page.getByRole("navigation", { name: "主导航" });
const active = async (label) => {
  await nav().getByRole("link", { name: label, exact: true }).and(page.locator('[aria-current="page"]')).waitFor();
  assert.equal(await nav().locator('[aria-current="page"]').innerText(), label);
};
try {
  for (const [path, label] of [["analysis", "研判"], ["warnings", "预警"], ["tagging", "打标"], ["police", "查询"], ["police-stats", "统计"], ["dashboard", "大屏"]]) {
    await page.goto(`${base}/report/${path}`);
    await active(label);
    if (path === "dashboard") {
      await page.getByRole("heading", { name: "功能待接入" }).waitFor();
    } else {
      const headings = { analysis: "标签组合", warnings: "预警模型", tagging: "警情打标", police: "警情查询", "police-stats": "110 统计" };
      await page.getByRole("heading", { name: new RegExp(headings[path]) }).first().waitFor();
      assert.equal(await page.getByRole("heading", { name: "功能待接入" }).count(), 0);
    }
  }
  await nav().getByRole("link", { name: "研判", exact: true }).click();
  await active("研判");
  await nav().getByRole("link", { name: "预警", exact: true }).click();
  await active("预警");
  await page.goBack();
  await active("研判");
  await page.goForward();
  await active("预警");
  console.log("PASS direct routes and browser back/forward");

  const cwd = process.cwd();
  await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`);
  await active("对话");
  const composer = page.locator("textarea").first();
  await composer.waitFor();
  const draft = "workspace navigation draft — do not send";
  await composer.fill(draft);
  await nav().getByRole("link", { name: "打标", exact: true }).click();
  await active("打标");
  await nav().getByRole("link", { name: "对话", exact: true }).click();
  await active("对话");
  await page.waitForFunction((expected) => document.querySelector("textarea")?.value === expected, draft);
  console.log("PASS returning to chat retains the unsent draft");

  await page.setViewportSize({ width: 390, height: 844 });
  await nav().getByRole("link", { name: "预警", exact: true }).click();
  await active("预警");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await nav().getByRole("link").count(), 7);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const label of ["查询", "统计", "大屏"]) {
      await nav().getByRole("link", { name: label, exact: true }).click();
      await active(label);
      const bounds = await nav().getByRole("link", { name: label, exact: true }).boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, "active link scrolls into view");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  }
  await nav().getByRole("link", { name: "对话", exact: true }).click();
  await page.waitForFunction((expected) => document.querySelector("textarea")?.value === expected, draft);
  const box = await composer.boundingBox();
  assert.ok(box && box.y + box.height <= 844, "composer fits below the navigation");
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  console.log("PASS mobile layout; no page errors, server errors or agent prompts");
} finally {
  await browser.close();
}
