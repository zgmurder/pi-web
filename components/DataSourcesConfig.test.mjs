import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('./DataSourcesConfig.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('./DataSourcesConfig.module.css', import.meta.url), 'utf8');
test('source settings use shared split/list primitives and distinct save/test/delete actions', () => {
  for (const component of ['ConfigSplitView', 'ConfigSidebar', 'ConfigSidebarItem', 'ConfigDetailHeader']) assert.ok(source.includes(`<${component}`));
  assert.match(source, /active=\{draft.id === s.id\}/);
  assert.match(source, /variant="primary"[^\n]*act\("save"\)/);
  assert.match(source, /window.confirm/);
  assert.match(source, /setStatus\(t\(action === "test" \? "dataSource.testing"/);
  assert.match(source, /role=\{failed \? "alert" : "status"\}/);
});
test('source settings have stacked mobile layout and reduced-motion support', () => {
  assert.match(css, /max-width: 767px/);
  assert.match(css, /flex-direction: column/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /focus-visible/);
});
