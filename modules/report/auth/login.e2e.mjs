// Uses the existing dev server; never submits credentials to the real Report service.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.PI_WEB_TEST_URL || "http://127.0.0.1:30142";
const browser = await chromium.launch(process.env.PI_WEB_TEST_CHANNEL ? { channel: process.env.PI_WEB_TEST_CHANNEL } : {});
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const anonymous = await context.request.get(`${base}/api/sessions`);
  assert.equal(anonymous.status(), 401);
  await page.goto(`${base}/report/police?keyword=test`);
  await page.getByRole("heading", { name: "警情分析助手" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/login");
  assert.equal(new URL(page.url()).searchParams.get("next"), "/report/police?keyword=test");
  assert.equal(await page.getByRole("button", { name: "登录", exact: true }).isDisabled(), false);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bounds = await page.getByLabel("密码", { exact: true }).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
  }
  console.log("PASS anonymous API refusal, business redirect and Chinese login on an English browser; mobile layout");

  let status = 401;
  let payload;
  await page.route("**/api/web-auth", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    payload = route.request().postDataJSON();
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(status === 200 ? { ok: true } : { error: "test failure" }) });
  });
  await page.getByLabel("用户名", { exact: true }).fill("test-user");
  await page.getByLabel("密码", { exact: true }).fill("test-only-password");
  for (const [code, message] of [[401, "用户名或密码错误"], [429, "登录尝试过于频繁，请稍后重试。"], [503, "Report 登录服务暂不可用，请稍后重试。"]]) {
    status = code;
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: message }).waitFor();
  }
  assert.deepEqual(payload, { username: "test-user", password: "test-only-password" });
  console.log("PASS login JSON contract and Chinese credential/rate-limit/service errors (mocked)");

  // Intercept only the destination document; no authenticated API or model request is made.
  const target = "/report/police?keyword=test";
  await page.route(`${base}${target}`, (route) => route.fulfill({ contentType: "text/html", body: "<h1>Test destination</h1>" }));
  status = 200;
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "Test destination" }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, target);
  assert.deepEqual(errors, []);
  console.log("PASS successful form returns to original destination (mocked); no page errors");
} finally {
  await browser.close();
}
