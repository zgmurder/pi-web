import type { CellValue } from "read-excel-file/browser";

export function isSpreadsheetPath(filePath: string): boolean {
  return /\.xlsx$/i.test(filePath);
}

export function spreadsheetColumnLabel(index: number): string {
  let label = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

export interface SpreadsheetSelection {
  sheet: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  range: string;
}

export function spreadsheetSelection(
  sheet: string,
  anchorRow: number,
  anchorColumn: number,
  focusRow: number,
  focusColumn: number,
): SpreadsheetSelection {
  const startRow = Math.min(anchorRow, focusRow);
  const endRow = Math.max(anchorRow, focusRow);
  const startColumn = Math.min(anchorColumn, focusColumn);
  const endColumn = Math.max(anchorColumn, focusColumn);
  const first = `${spreadsheetColumnLabel(startColumn)}${startRow + 1}`;
  const last = `${spreadsheetColumnLabel(endColumn)}${endRow + 1}`;
  return {
    sheet,
    startRow,
    endRow,
    startColumn,
    endColumn,
    range: first === last ? first : `${first}:${last}`,
  };
}

export function formatSpreadsheetCell(value: CellValue | null): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}
