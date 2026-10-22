import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DEFAULT_THEME, DARK_THEMES, LIGHT_THEMES, THEME_INIT_SCRIPT, THEME_OPTIONS, isDarkTheme, isThemePreference } from "./theme.ts";

test("first paint restores saved palettes and defaults to Rose for missing, invalid or blocked storage", () => {
  assert.equal(DEFAULT_THEME, "rose");
  for (const systemDark of [false, true]) {
    for (const stored of [...THEME_OPTIONS.map(({ id }) => id), null, "", "unknown", new Error("Blocked")]) {
      const root = { dataset: {}, classList: { toggle: (name, value) => { root[name] = value; } } };
      runInNewContext(THEME_INIT_SCRIPT, {
        localStorage: { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
        window: { matchMedia: () => ({ matches: systemDark }) },
        document: { documentElement: root },
      });
      const expected = stored === "auto" ? (systemDark ? "dark" : "light") : isThemePreference(stored) ? stored : DEFAULT_THEME;
      assert.equal(root.dataset.theme, expected);
      assert.equal(root.dark, isDarkTheme(expected));
    }
  }
});

test("every palette belongs to exactly one of the light and dark sets", () => {
  const palettes = THEME_OPTIONS.map(({ id }) => id).filter((id) => id !== "auto");
  assert.deepEqual([...LIGHT_THEMES, ...DARK_THEMES].sort(), [...palettes].sort());
  assert.equal(LIGHT_THEMES.some((id) => DARK_THEMES.includes(id)), false);
  assert.ok(LIGHT_THEMES.includes("light") && DARK_THEMES.includes("dark"));
});
