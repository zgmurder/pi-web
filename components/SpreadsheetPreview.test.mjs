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

test("xlsx preview selects cell ranges and can mention them", () => {
  assert.match(source, /onPointerDown=\{\(event\) => handleCellPointerDown/);
  assert.match(source, /onPointerEnter=\{\(\) => handleCellPointerEnter/);
  assert.match(source, /if \(!onMentionSelection\) return/);
  assert.match(source, /onMentionSelection\(selection\.sheet, selection\.range\)/);
});
