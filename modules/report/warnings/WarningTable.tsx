import type { ReactNode } from "react";
import { bjlxDisplay, fmtGrowth, periodText, periodTitles, previousCount, rowKey } from "./model";
import type { WarningRow, WarningRuleKind } from "./types";
import styles from "./warnings.module.css";

type Column = { title: string; width?: number; render: (row: WarningRow) => ReactNode };
function Growth({ value }: { value?: number | null }) { return <span className={value == null ? styles.muted : styles.growth}>{value == null ? "—" : fmtGrowth(value)}</span>; }
function Count({ date, count, growth }: { date?: string | null; count?: number | null; growth?: number | null }) {
  return <div className={styles.count}><div><strong>{count ?? "-"}</strong>{growth !== undefined && <Growth value={growth} />}</div>{date && <small>{date}</small>}</div>;
}
function Type({ row }: { row: WarningRow }) { return <div className={styles.typeCell}><span className={styles.tag}>{bjlxDisplay(row)}</span>{row.bjlxName && row.bjlxdm && <small>代码 {row.bjlxdm}</small>}</div>; }
function WarningText({ row }: { row: WarningRow }) { return <span className={styles.ellipsis} title={row.warningText || undefined}>{row.warningText || "-"}</span>; }
export function warningColumns(key: string, kind: WarningRuleKind): Column[] {
  const warning: Column = { title: "预警说明", width: 300, render: (row) => <WarningText row={row} /> };
  if (kind === "type_rise") return [
    { title: "报警类型", width: 120, render: (row) => <Type row={row} /> },
    ...(key === "type3dayRise" ? [
      { title: "第1日", width: 110, render: (row: WarningRow) => <Count date={row.day1Date} count={row.day1Cnt} /> },
      { title: "第2日", width: 130, render: (row: WarningRow) => <Count date={row.day2Date} count={row.day2Cnt} growth={row.day2GrowthRate} /> },
      { title: "第3日", width: 130, render: (row: WarningRow) => <Count date={row.day3Date} count={row.day3Cnt} growth={row.day3GrowthRate} /> },
      { title: "第4日", width: 130, render: (row: WarningRow) => <Count date={row.day4Date} count={row.day4Cnt} growth={row.day4GrowthRate} /> },
    ] : [
      { title: "第1周", width: 110, render: (row: WarningRow) => <Count date={row.week1Start} count={row.week1Cnt} /> },
      { title: "第2周", width: 130, render: (row: WarningRow) => <Count date={row.week2Start} count={row.week2Cnt} growth={row.week2GrowthRate} /> },
      { title: "第3周", width: 130, render: (row: WarningRow) => <Count date={row.week3Start} count={row.week3Cnt} growth={row.week3GrowthRate} /> },
    ]), warning,
  ];
  if (kind === "station") {
    const titles = periodTitles(key);
    return [
      { title: "派出所", width: 140, render: (row) => <strong>{row.deptName || "-"}</strong> },
      { title: titles.period, width: 130, render: (row) => periodText(row, key) },
      { title: titles.previous, width: 100, render: (row) => <strong>{previousCount(row, key) == null ? "-" : `${previousCount(row, key)} 起`}</strong> },
      { title: "本期数量", width: 100, render: (row) => <strong>{row.cnt == null ? "-" : `${row.cnt} 起`}</strong> },
      { title: titles.rate, width: 110, render: (row) => <Growth value={row.growthRate} /> }, warning,
    ];
  }
  if (kind === "station_alarm" || kind === "community_alarm") return [
    { title: "区域", width: 150, render: (row) => <strong>{row.areaName || "-"}</strong> },
    { title: "警情类型", width: 130, render: (row) => <span className={styles.tag}>{row.alarmType || "-"}</span> },
    { title: "统计周期", width: 120, render: (row) => row.periodStart || "-" },
    { title: "本期数量", width: 100, render: (row) => <strong>{row.currentCnt == null ? "-" : `${row.currentCnt} 起`}</strong> },
    { title: "升幅", width: 100, render: (row) => <Growth value={row.growthRate} /> }, { ...warning, width: 320 },
  ];
  return [
    { title: "姓名", width: 110, render: (row) => <strong>{row.personName || "-"}</strong> },
    { title: "联系电话", width: 130, render: (row) => row.lxdh || "-" },
    { title: "报警次数", width: 90, render: (row) => <span className={styles.growth}>{row.totalCnt == null ? "-" : `${row.totalCnt} 次`}</span> },
    { title: "活跃天数", width: 90, render: (row) => row.activeDays ?? "-" },
    { title: "首次报警", width: 150, render: (row) => row.firstTime || "-" },
    { title: "末次报警", width: 150, render: (row) => row.lastTime || "-" },
    { title: "涉及类型", width: 110, render: (row) => row.typeNames ? <div className={styles.tags}>{row.typeNames.split(",").filter(Boolean).map((name, index) => <span className={styles.tag} key={`${name}-${index}`}>{name}</span>)}</div> : "-" },
    { title: "涉及派出所", width: 200, render: (row) => <span className={styles.ellipsis} title={row.deptNames || undefined}>{row.deptNames || "-"}</span> },
  ];
}
export function WarningTable({ rows, ruleKey: key, kind, selectedKey, loading, onSelect }: { rows: WarningRow[]; ruleKey: string; kind: WarningRuleKind; selectedKey: string; loading: boolean; onSelect: (row: WarningRow) => void }) {
  const columns = warningColumns(key, kind);
  return <div className={styles.tableBody} aria-busy={loading}>
    <div className={styles.tableScroll}>
      <table className={styles.table} aria-label="预警记录">
        <colgroup>{columns.map((column) => <col key={column.title} style={{ width: column.width }} />)}</colgroup>
        <thead><tr>{columns.map((column) => <th scope="col" key={column.title}>{column.title}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${rowKey(row, key)}-${index}`} className={rowKey(row, key) === selectedKey ? styles.selectedRow : undefined} onClick={() => onSelect(row)}>
          {columns.map((column, columnIndex) => <td key={column.title}>{columnIndex === 0 ? <button type="button" className={styles.rowButton} aria-label={`查看第 ${index + 1} 条预警详情`} onClick={(event) => { event.stopPropagation(); onSelect(row); }}>{column.render(row)}</button> : column.render(row)}</td>)}
        </tr>)}</tbody>
      </table>
      {!rows.length && !loading && <div className={styles.empty}>暂无数据</div>}
    </div>
    {loading && <div className={styles.loading} role="status"><span className={styles.spinner} />加载中…</div>}
  </div>;
}
