import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./spreadsheet.ts");
}

test("recognizes modern Excel workbooks", async () => {
  const { isSpreadsheetPath } = await loadSubject();

  assert.equal(isSpreadsheetPath("/tmp/report.xlsx"), true);
  assert.equal(isSpreadsheetPath("C:\\data\\REPORT.XLSX"), true);
  assert.equal(isSpreadsheetPath("/tmp/legacy.xls"), false);
  assert.equal(isSpreadsheetPath("/tmp/report.csv"), false);
});

test("labels spreadsheet columns past Z", async () => {
  const { spreadsheetColumnLabel } = await loadSubject();

  assert.equal(spreadsheetColumnLabel(0), "A");
  assert.equal(spreadsheetColumnLabel(25), "Z");
  assert.equal(spreadsheetColumnLabel(26), "AA");
  assert.equal(spreadsheetColumnLabel(701), "ZZ");
  assert.equal(spreadsheetColumnLabel(702), "AAA");
});

test("builds normalized spreadsheet selections", async () => {
  const { spreadsheetSelection } = await loadSubject();

  assert.deepEqual(spreadsheetSelection("警情统计", 4, 2, 1, 0), {
    sheet: "警情统计",
    startRow: 1,
    endRow: 4,
    startColumn: 0,
    endColumn: 2,
    range: "A2:C5",
  });
  assert.equal(spreadsheetSelection("汇总", 0, 26, 0, 26).range, "AA1");
});

test("formats spreadsheet cell values for display", async () => {
  const { formatSpreadsheetCell } = await loadSubject();

  assert.equal(formatSpreadsheetCell(null), "");
  assert.equal(formatSpreadsheetCell(12.5), "12.5");
  assert.equal(formatSpreadsheetCell(false), "false");
  assert.equal(formatSpreadsheetCell("警情"), "警情");
});
