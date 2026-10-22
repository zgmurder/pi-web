import type { DepartmentItem, DepartmentScope, DeptNode, DeptOption, WarningFilters, WarningListQuery, WarningRow, WarningRuleKind, WarningUser } from "./types";

export function flattenDepartmentTree(items: DepartmentItem[], parentId = 0): DeptOption[] {
  return items.flatMap((item) => {
    const deptId = Number(item.id || 0);
    return [{ deptId, deptName: item.name || item.code || String(deptId), deptCode: item.code || String(deptId), parentId: item.parent_id == null ? parentId : Number(item.parent_id), orderNum: Number(item.sort_order || 0) }, ...flattenDepartmentTree(item.children || [], deptId)];
  });
}
export function collectDeptScopeIds(depts: DeptOption[], rootDeptId: number) {
  const ids = new Set<number>([rootDeptId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const dept of depts) {
      if (dept.deptId && dept.parentId && ids.has(dept.parentId) && !ids.has(dept.deptId)) {
        ids.add(dept.deptId); changed = true;
      }
    }
  }
  return ids;
}
export function buildDeptTreeOptions(depts: DeptOption[]): DeptNode[] {
  const sorted = [...depts].sort((a, b) => a.orderNum - b.orderNum || a.deptName.localeCompare(b.deptName, "zh-CN"));
  const nodes = new Map<number, DeptNode>();
  for (const dept of sorted) if (dept.deptId) nodes.set(dept.deptId, { key: String(dept.deptId), label: dept.deptName, children: [] });
  const roots: DeptNode[] = [];
  for (const dept of sorted) {
    const node = nodes.get(dept.deptId);
    if (!node) continue;
    const parent = nodes.get(dept.parentId);
    if (parent && parent !== node) parent.children!.push(node); else roots.push(node);
  }
  return roots;
}
export function departmentScope(items: DepartmentItem[], user: WarningUser): DepartmentScope {
  const all = flattenDepartmentTree(items);
  const code = String(user.unit_code || "").trim();
  const name = String(user.department_name || "").trim();
  const account = all.find((dept) => dept.deptCode.trim() === code) || all.find((dept) => name && dept.deptName.trim() === name);
  // Never offer another department when a non-root account cannot be resolved.
  const ids = account ? collectDeptScopeIds(all, account.deptId) : new Set<number>();
  const options = user.is_root_department ? all : all.filter((dept) => ids.has(dept.deptId));
  return { options, tree: buildDeptTreeOptions(options), defaultKey: !user.is_root_department && account ? String(account.deptId) : "", isCityBureau: user.is_root_department };
}
export function emptyFilters(defaultKey = ""): WarningFilters {
  return { bjlxdm: "", keyword: "", deptName: "", minTotalCnt: "", beginDate: "", endDate: "", deptKey: defaultKey };
}
export function buildWarningQuery(ruleKey: string, kind: WarningRuleKind, filters: WarningFilters, pageNum: number, pageSize: number, scope: DepartmentScope): WarningListQuery {
  if (filters.beginDate && filters.endDate && filters.beginDate > filters.endDate) throw new Error("开始日期不能晚于结束日期");
  const query: WarningListQuery = { ruleKey, pageNum, pageSize, beginDate: filters.beginDate || undefined, endDate: filters.endDate || undefined };
  if (kind === "type_rise") query.bjlxdm = filters.bjlxdm || undefined;
  else if (kind === "station") {
    const key = filters.deptKey || scope.defaultKey;
    const dept = scope.options.find((item) => String(item.deptId) === key);
    if ((!scope.isCityBureau && !dept) || (key && !dept)) throw new Error("无法确认当前部门范围，请重新加载部门列表");
    query.deptCode = dept?.deptCode || undefined;
    query.deptName = dept?.deptName || undefined;
    query.keyword = filters.keyword.trim() || undefined;
  } else {
    query.keyword = filters.keyword.trim() || undefined;
    if (kind === "person") {
      query.deptName = filters.deptName.trim() || undefined;
      const minimum = Number(filters.minTotalCnt);
      if (filters.minTotalCnt && (!Number.isInteger(minimum) || minimum < 1)) throw new Error("最少报警次数须为正整数");
      query.minTotalCnt = minimum || undefined;
    }
  }
  return query;
}
export function bjlxDisplay(row: WarningRow) { return row.bjlxName || (row.bjlxdm ? `类型${row.bjlxdm}` : "-"); }
export function fmtGrowth(value?: number | null) { return value == null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
export function monthText(value?: string | null) { return value ? `${value.slice(0, 4)}年${value.slice(5, 7)}月` : "-"; }
export function periodTitles(key: string) {
  return {
    period: key === "stationDailyHb30" ? "统计日期" : key === "stationWeeklyHb30" ? "周起始" : ["stationMonthlyHb30", "stationMonthlyTb30"].includes(key) ? "月份" : "统计周期",
    previous: ({ stationDailyHb30: "前日数量", stationWeeklyHb30: "上周数量", stationMonthlyHb30: "上月数量", stationMonthlyTb30: "去年同期" } as Record<string, string>)[key] || "-",
    rate: key === "stationMonthlyTb30" ? "同比上升" : "环比上升",
  };
}
export function periodText(row: WarningRow, key: string) { return key === "stationDailyHb30" ? row.statDate || "-" : key === "stationWeeklyHb30" ? row.weekStart ? `${row.weekStart} 当周` : "-" : monthText(row.monthStart); }
export function previousCount(row: WarningRow, key: string) { return (key === "stationMonthlyTb30" ? row.prevYearCnt : row.prevCnt) ?? null; }
export function rowKey(row: WarningRow, key: string) {
  switch (key) {
    case "type3dayRise": return `${row.bjlxdm}|${row.day4Date}`;
    case "type2weekRise": return `${row.bjlxdm}|${row.week3Start}`;
    case "repeatPerson90d": return row.lxdh || `${row.personName}|${row.firstTime}`;
    default: return `${row.areaCode || row.deptCode}|${row.alarmType || ""}|${row.periodStart || row.statDate || row.weekStart || row.monthStart}`;
  }
}
export interface TrendBar { label: string; sub: string; count: number; growth: number | null }
export function trendBars(row: WarningRow, key: string, kind: WarningRuleKind): TrendBar[] {
  if (key === "type3dayRise") return [
    { label: "第1日", sub: row.day1Date || "", count: row.day1Cnt ?? 0, growth: null },
    { label: "第2日", sub: row.day2Date || "", count: row.day2Cnt ?? 0, growth: row.day2GrowthRate ?? null },
    { label: "第3日", sub: row.day3Date || "", count: row.day3Cnt ?? 0, growth: row.day3GrowthRate ?? null },
    { label: "第4日", sub: row.day4Date || "", count: row.day4Cnt ?? 0, growth: row.day4GrowthRate ?? null },
  ];
  if (key === "type2weekRise") return [
    { label: "第1周", sub: row.week1Start || "", count: row.week1Cnt ?? 0, growth: null },
    { label: "第2周", sub: row.week2Start || "", count: row.week2Cnt ?? 0, growth: row.week2GrowthRate ?? null },
    { label: "第3周", sub: row.week3Start || "", count: row.week3Cnt ?? 0, growth: row.week3GrowthRate ?? null },
  ];
  const labels: Record<string, [string, string, string, string]> = {
    stationDailyHb30: ["前一日", "当日", (row.statDate || "").slice(5), row.statDate || ""],
    stationWeeklyHb30: ["上周", "本周", "", row.weekStart || ""],
    stationMonthlyHb30: ["上月", "本月", "", monthText(row.monthStart)],
    stationMonthlyTb30: ["去年同期", "本月", "", monthText(row.monthStart)],
  };
  if (labels[key]) {
    const [previous, current, prevSub, sub] = labels[key];
    return [{ label: previous, sub: prevSub, count: previousCount(row, key) ?? 0, growth: null }, { label: current, sub, count: row.cnt ?? 0, growth: row.growthRate ?? null }];
  }
  if (kind === "station_alarm" || kind === "community_alarm") return (row.trend || []).map((item, index) => ({ label: `第${index + 1}期`, sub: item.date || "", count: item.count ?? 0, growth: index === row.trend!.length - 1 ? row.growthRate ?? null : null }));
  return [];
}
export function detailFields(row: WarningRow, key: string, kind: WarningRuleKind): Array<{ label: string; value: string }> {
  const fmt = (value?: string | null) => value || "-";
  let fields: Array<[string, string]> = [];
  if (key === "type3dayRise" || key === "type2weekRise") {
    const bars = trendBars(row, key, kind);
    const counts = key === "type3dayRise" ? [row.day1Cnt, row.day2Cnt, row.day3Cnt, row.day4Cnt] : [row.week1Cnt, row.week2Cnt, row.week3Cnt];
    fields = [["报警类型", `${bjlxDisplay(row)}（代码 ${row.bjlxdm || "-"}）`], ...bars.map((bar, i): [string, string] => [bar.label, `${fmt(bar.sub)}${key === "type2weekRise" ? "起" : ""} ${counts[i] ?? "-"} 起`]), ...bars.slice(1).map((bar): [string, string] => [`${bar.label}环比`, fmtGrowth(bar.growth)])];
  } else if (["stationDailyHb30", "stationWeeklyHb30", "stationMonthlyHb30", "stationMonthlyTb30"].includes(key)) {
    const titles = periodTitles(key);
    const currentLabel = key === "stationDailyHb30" ? "当日数量" : key === "stationWeeklyHb30" ? "本周数量" : "本月数量";
    fields = [["派出所", fmt(row.deptName)], [titles.period, key === "stationDailyHb30" ? fmt(row.statDate) : key === "stationWeeklyHb30" ? fmt(row.weekStart) : monthText(row.monthStart)], [titles.previous, `${previousCount(row, key) ?? "-"} 起`], [currentLabel, `${row.cnt ?? "-"} 起`], [titles.rate, fmtGrowth(row.growthRate)]];
  } else if (key === "repeatPerson90d") {
    fields = [["姓名", fmt(row.personName)], ["联系电话", fmt(row.lxdh)], ["报警次数", `${row.totalCnt ?? "-"} 次`], ["活跃天数", `${row.activeDays ?? "-"} 天`], ["首次报警", fmt(row.firstTime)], ["末次报警", fmt(row.lastTime)], ["涉及类型", fmt(row.typeNames)], ["涉及派出所", fmt(row.deptNames)]];
  } else if (kind === "station_alarm" || kind === "community_alarm") {
    fields = [[kind === "community_alarm" ? "社区" : "派出所", fmt(row.areaName)], ["区域代码", fmt(row.areaCode)], ["警情类型", fmt(row.alarmType)], ["统计周期", fmt(row.periodStart)], ["本期数量", `${row.currentCnt ?? "-"} 起`], ["升幅", fmtGrowth(row.growthRate)]];
  }
  return fields.map(([label, value]) => ({ label, value }));
}
export function personDeptTags(row: WarningRow) { return String(row.deptNames || "").split(/[,，、;；]/).map((item) => item.trim()).filter(Boolean); }
export function pageNumbers(current: number, pages: number) {
  return [...new Set([1, ...Array.from({ length: 5 }, (_, i) => current - 2 + i), pages])].filter((page) => page >= 1 && page <= pages).sort((a, b) => a - b);
}
