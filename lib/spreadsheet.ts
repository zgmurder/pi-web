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

export function formatSpreadsheetCell(value: CellValue | null): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}
