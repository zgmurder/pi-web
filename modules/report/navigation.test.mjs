import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { workspaceItems, isWorkspaceItemActive } = await jiti.import("./navigation.ts");

test("seven workspaces have separate routes and exactly one active link", () => {
  assert.deepEqual(workspaceItems.map(({ href }) => href), ["/", "/report/analysis", "/report/warnings", "/report/tagging", "/report/police", "/report/police-stats", "/report/dashboard"]);
  for (const item of workspaceItems) {
    assert.deepEqual(workspaceItems.filter(({ href }) => isWorkspaceItemActive(item.href, href)), [item]);
  }
});

test("nested business pages keep their section active without matching path prefixes", () => {
  assert.equal(isWorkspaceItemActive("/report/analysis/123", "/report/analysis"), true);
  assert.equal(isWorkspaceItemActive("/report/analysis-extra", "/report/analysis"), false);
  assert.equal(isWorkspaceItemActive("/report/analysis", "/"), false);
  assert.equal(isWorkspaceItemActive("/report/police-stats", "/report/police"), false);
});
