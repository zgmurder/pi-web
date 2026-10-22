// Read-only theme regression against real data. Keep storageState outside Git.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.PI_WEB_TEST_URL;
const storageState = process.env.PI_WEB_TEST_STORAGE_STATE;
if (!base || !storageState) throw new Error("Set PI_WEB_TEST_URL and PI_WEB_TEST_STORAGE_STATE");
const browser = await chromium.launch({ channel: process.env.PI_WEB_TEST_CHANNEL || "chrome" });
const context = await browser.newContext({ storageState, reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(130_000);
const errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (/\/api\/report\/business\/(tags\/packages|tags-v2\/alarms\/verify)/.test(request.url()) && request.method() !== "GET") writes.push(request.url());
});
const themes = ["light", "dark", "mist", "pine", "contrast-dark"];
async function setTheme(theme) {
  await page.evaluate(theme => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", ["dark", "pine", "contrast-dark"].includes(theme));
  }, theme);
  await page.waitForTimeout(200); // Let existing color transitions finish before inspecting computed styles.
}
async function checkSurface(locator, background, primary) {
  assert.deepEqual(await locator.evaluate((element, { background, primary }) => {
    const root = getComputedStyle(document.documentElement), style = getComputedStyle(element);
    const failures = [];
    for (const token of ["--bg", "--bg-panel", "--bg-hover", "--bg-selected", "--border", "--text", "--accent", "--accent-contrast"]) {
      if (style.getPropertyValue(token).trim() !== root.getPropertyValue(token).trim()) failures.push(token);
    }
    // Resolve theme tokens through CSS to compare normalized browser colors.
    const probe = document.createElement("span");
    element.append(probe);
    const color = token => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
    if (style.backgroundColor !== color(background)) failures.push("background");
    if (style.color !== color("--text")) failures.push("text");
    if (style.colorScheme !== root.colorScheme) failures.push(`color-scheme: ${style.colorScheme} vs ${root.colorScheme}`);
    for (const input of element.querySelectorAll('input[type="date"], input[type="datetime-local"]')) {
      if (getComputedStyle(input).colorScheme !== root.colorScheme) failures.push("native date scheme");
    }
    if (primary) {
      const button = element.querySelector(primary);
      if (!button) failures.push("missing primary control");
      else {
        const buttonStyle = getComputedStyle(button);
        if (buttonStyle.backgroundColor !== color("--accent")) failures.push(`primary background: ${buttonStyle.backgroundColor} vs ${color("--accent")}`);
        if (buttonStyle.color !== color("--accent-contrast")) failures.push("primary contrast");
      }
    }
    probe.remove();
    return failures;
  }, { background, primary }), []);
}
async function checkThemes(locator, background, primary) {
  await page.mouse.move(0, 0);
  for (const theme of themes) {
    await setTheme(theme);
    await checkSurface(locator, background, primary).catch(error => { error.message = `${theme}: ${error.message}`; throw error; });
  }
}
try {
  for (const [path, title] of [["analysis", "标签组合"], ["tagging", "警情打标"], ["warnings", "预警模型"], ["police", "警情查询"], ["police-stats", "110 统计"]]) {
    await page.goto(`${base}/report/${path}`);
    await page.getByRole("heading", { name: new RegExp(`^${title}`) }).first().waitFor();
    const surface = page.locator('[class*="business-module"]').first();
    await checkThemes(surface, "--bg", 'button[class*="primary"]');
    if (path === "analysis") {
      await page.getByRole("button", { name: "新增组合", exact: true }).click();
      await checkThemes(page.getByRole("dialog"), "--bg-panel", 'button[class*="primary"]');
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
    if (path === "tagging") {
      await surface.locator('button[aria-expanded="false"]').first().click();
      const menu = page.locator('body > [role="group"]');
      await menu.waitFor();
      await checkThemes(menu, "--bg-panel");
      await page.keyboard.press("Escape");
    }
    if (path === "warnings") {
      await page.getByRole("button", { name: "查看第 1 条预警详情", exact: true }).click();
      await checkThemes(page.getByRole("dialog"), "--bg-panel");
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, path);
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log(`PASS ${path}: ${themes.join(", ")}, native controls and mobile width`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} finally {
  await context.close();
  await browser.close();
}
