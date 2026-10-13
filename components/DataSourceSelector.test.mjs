import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('./DataSourceSelector.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('./DataSourceSelector.module.css', import.meta.url), 'utf8');
test('data source popup reuses reasoning selector rows and retains permission guards', () => {
  assert.match(source, /import \{ SelectorRow \}/);
  assert.doesNotMatch(source, /<select\b/);
  assert.match(source, /<fieldset disabled=\{chatOnly\}/);
  assert.match(source, /disabled=\{disabled \|\| busy\}/);
  assert.match(source, /chatOnly && value && value !== "__manage__"/);
  assert.match(source, /type: "set_data_source"/);
});
test('popup includes keyboard navigation, dismissal and reasoning popup geometry', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) assert.ok(source.includes(`"${key}"`));
  assert.match(source, /removeEventListener\("pointerdown", dismiss\)/);
  assert.match(source, /aria-expanded=\{visible\}/);
  assert.match(source, /role="listbox"/);
  assert.match(css, /bottom: calc\(100% \+ 6px\)/);
  assert.match(css, /border-radius: 8px/);
  assert.match(css, /prefers-reduced-motion/);
});
