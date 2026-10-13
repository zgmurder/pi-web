"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import readExcelFile from "read-excel-file/browser";
import { measureColumnWidths, visibleRowRange } from "@/lib/delimited-table";
import { getFileName } from "@/lib/file-paths";
import { formatSpreadsheetCell, spreadsheetColumnLabel, spreadsheetSelection, type SpreadsheetSelection } from "@/lib/spreadsheet";
import { useI18n } from "@/hooks/useI18n";

const ROW_HEIGHT = 26;
const GUTTER_WIDTH = 56;
const OVERSCAN_ROWS = 20;

const ROW: CSSProperties = {
  display: "flex",
  height: ROW_HEIGHT,
  boxSizing: "border-box",
  borderBottom: "1px solid var(--border)",
};

const GUTTER: CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  boxSizing: "border-box",
  width: GUTTER_WIDTH,
  flexShrink: 0,
  padding: "0 10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  color: "var(--text-dim)",
  background: "var(--bg-panel)",
  borderRight: "1px solid var(--border)",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  userSelect: "none",
};

const CELL: CSSProperties = {
  boxSizing: "border-box",
  flexShrink: 0,
  padding: "0 10px",
  lineHeight: `${ROW_HEIGHT - 1}px`,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  borderRight: "1px solid var(--border)",
};

interface SpreadsheetSheet {
  sheet: string;
  rows: string[][];
}

export function SpreadsheetPreview({
  url,
  filePath,
  maxBytes,
  onMentionSelection,
}: {
  url: string;
  filePath: string;
  maxBytes: number;
  onMentionSelection?: (sheet: string, range: string) => void;
}) {
  const { t } = useI18n();
  const [sheets, setSheets] = useState<SpreadsheetSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [selection, setSelection] = useState<SpreadsheetSelection | null>(null);
  const anchorRef = useRef<{ row: number; column: number } | null>(null);
  const selectingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSheets([]);
    setActiveSheet(0);
    setSelection(null);

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > maxBytes) {
          throw new Error("XLSX too large for preview (>10MB)");
        }
        const data = await response.arrayBuffer();
        if (data.byteLength > maxBytes) throw new Error("XLSX too large for preview (>10MB)");
        return data;
      })
      .then((data) => readExcelFile(data))
      .then((workbook) => {
        if (controller.signal.aborted) return;
        setSheets(workbook.map(({ sheet, data }) => ({
          sheet,
          rows: data.map((row) => row.map(formatSpreadsheetCell)),
        })));
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [maxBytes, url]);

  useEffect(() => {
    if (loading) return;
    const element = scrollRef.current;
    if (!element) return;
    const sync = () => {
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(element);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [loading]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = 0;
    element.scrollLeft = 0;
    setScrollTop(0);
    setSelection(null);
    anchorRef.current = null;
  }, [activeSheet]);

  const sheet = sheets[activeSheet];
  const columnCount = useMemo(
    () => sheet?.rows.reduce((widest, row) => Math.max(widest, row.length), 0) ?? 0,
    [sheet],
  );
  const columns = useMemo(
    () => Array.from({ length: columnCount }, (_, index) => spreadsheetColumnLabel(index)),
    [columnCount],
  );
  const widths = useMemo(() => measureColumnWidths(columns, sheet?.rows ?? []), [columns, sheet]);
  const totalWidth = useMemo(() => widths.reduce((sum, width) => sum + width, GUTTER_WIDTH), [widths]);
  const range = visibleRowRange(
    sheet?.rows.length ?? 0,
    ROW_HEIGHT,
    Math.max(0, scrollTop - ROW_HEIGHT),
    viewportHeight,
    OVERSCAN_ROWS,
  );

  const selectCell = (row: number, column: number, extend: boolean) => {
    if (!sheet) return;
    const anchor = extend && anchorRef.current ? anchorRef.current : { row, column };
    anchorRef.current = anchor;
    setSelection(spreadsheetSelection(sheet.sheet, anchor.row, anchor.column, row, column));
  };

  const handleCellPointerDown = (event: MouseEvent, row: number, column: number) => {
    if (event.button !== 0) return;
    if (!onMentionSelection) return;
    event.preventDefault();
    selectingRef.current = true;
    selectCell(row, column, event.shiftKey);
  };

  const handleCellPointerEnter = (row: number, column: number) => {
    if (onMentionSelection && selectingRef.current) selectCell(row, column, true);
  };

  useEffect(() => {
    const stopSelecting = () => { selectingRef.current = false; };
    window.addEventListener("pointerup", stopSelecting);
    window.addEventListener("blur", stopSelecting);
    return () => {
      window.removeEventListener("pointerup", stopSelecting);
      window.removeEventListener("blur", stopSelecting);
    };
  }, []);

  if (loading) {
    return <div style={{ padding: 24, color: "var(--text-dim)", fontSize: 12 }}>Loading spreadsheet…</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: "#f87171", fontSize: 13 }}>Failed to preview {getFileName(filePath)}: {error}</div>;
  }
  if (!sheet || sheet.rows.length === 0) {
    return <div style={{ padding: 24, color: "var(--text-dim)", fontSize: 12 }}>This workbook is empty.</div>;
  }

  const renderedRows = [];
  for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    renderedRows.push(
      <div
        key={rowIndex}
        role="row"
        aria-rowindex={rowIndex + 1}
        style={{ ...ROW, position: "absolute", top: (rowIndex + 1) * ROW_HEIGHT, left: 0, width: totalWidth }}
      >
        <div role="rowheader" style={GUTTER}>{rowIndex + 1}</div>
        {widths.map((width, cellIndex) => {
          const value = row[cellIndex] ?? "";
          return (
            <div
              key={cellIndex}
              role="cell"
              aria-selected={selection
                ? rowIndex >= selection.startRow
                  && rowIndex <= selection.endRow
                  && cellIndex >= selection.startColumn
                  && cellIndex <= selection.endColumn
                : undefined}
              onPointerDown={(event) => handleCellPointerDown(event, rowIndex, cellIndex)}
              onPointerEnter={() => handleCellPointerEnter(rowIndex, cellIndex)}
              style={{
                ...CELL,
                width,
                cursor: onMentionSelection ? "cell" : undefined,
                background: selection
                  && rowIndex >= selection.startRow
                  && rowIndex <= selection.endRow
                  && cellIndex >= selection.startColumn
                  && cellIndex <= selection.endColumn
                  ? "var(--bg-selected)"
                  : undefined,
                outline: selection
                  && rowIndex === selection.startRow
                  && cellIndex === selection.startColumn
                  ? "1px solid var(--accent)"
                  : undefined,
                outlineOffset: -1,
              }}
              title={value || undefined}
            >
              {value}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {(sheets.length > 1 || selection) && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", borderBottom: "1px solid var(--border)", overflowX: "auto", flexShrink: 0 }}>
          {sheets.map((item, index) => (
            <button
              key={`${item.sheet}-${index}`}
              type="button"
              className="file-viewer-mode-button"
              aria-pressed={activeSheet === index}
              onClick={() => setActiveSheet(index)}
              style={{
                display: sheets.length > 1 ? undefined : "none",
                background: activeSheet === index ? "var(--bg-selected)" : "transparent",
                color: activeSheet === index ? "var(--text)" : "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {item.sheet}
            </button>
          ))}
          {selection && (
            <>
              <span style={{ marginLeft: sheets.length > 1 ? "auto" : undefined, padding: "0 6px", color: "var(--text-dim)", fontSize: 11, whiteSpace: "nowrap" }}>
                {selection.sheet} · {selection.range}
              </span>
              {onMentionSelection && (
                <button
                  type="button"
                  className="file-viewer-mode-button"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => onMentionSelection(selection.sheet, selection.range)}
                  title={t("i18n.mentionSelectedCells")}
                  aria-label={t("i18n.mentionSelectedCells")}
                  style={{ whiteSpace: "nowrap", color: "var(--accent)" }}
                >
                  @ {t("i18n.mentionSelectedCells")}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}
      >
        <div
          role="table"
          aria-rowcount={sheet.rows.length}
          aria-colcount={columnCount}
          style={{
            position: "relative",
            width: totalWidth,
            minWidth: "100%",
            height: (sheet.rows.length + 1) * ROW_HEIGHT,
            paddingTop: ROW_HEIGHT,
            boxSizing: "border-box",
            fontFamily: "var(--font-mono)",
            fontWeight: "var(--font-mono-weight)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <div
            role="row"
            aria-hidden="true"
            style={{
              ...ROW,
              position: "sticky",
              top: 0,
              zIndex: 2,
              marginTop: -ROW_HEIGHT,
              width: totalWidth,
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            <div style={GUTTER} />
            {columns.map((column, index) => (
              <div key={column} role="columnheader" style={{ ...CELL, width: widths[index], textAlign: "center" }}>
                {column}
              </div>
            ))}
          </div>
          {renderedRows}
        </div>
      </div>
    </div>
  );
}
