import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SpreadsheetPreview.tsx", import.meta.url), "utf8");

test("xlsx preview stays bounded and virtualized", () => {
  assert.match(source, /data\.byteLength > maxBytes/);
  assert.match(source, /visibleRowRange\(/);
  assert.match(source, /for \(let rowIndex = range\.start; rowIndex < range\.end/);
});

test("xlsx preview exposes workbook sheets", () => {
  assert.match(source, /sheets\.map\(\(item, index\)/);
  assert.match(source, /setActiveSheet\(index\)/);
});
