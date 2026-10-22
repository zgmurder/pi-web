import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { buildWarningQuery, departmentScope, emptyFilters, detailFields, trendBars, previousCount, rowKey, pageNumbers, personDeptTags, fmtGrowth } = await jiti.import("./model.ts");

const departments = [{ id: 1, name: "市局", code: "001", sort_order: 0, children: [
  { id: 2, name: "分局", code: "002", sort_order: 0, children: [{ id: 3, name: "派出所", code: "003", sort_order: 0 }] },
  { id: 4, name: "其他分局", code: "004", sort_order: 1 },
] }];
const local = departmentScope(departments, { unit_code: "002", is_root_department: false });
const root = departmentScope(departments, { unit_code: "001", is_root_department: true });

test("department scope restricts non-root accounts to their subtree and restores the account default", () => {
  assert.deepEqual(local.options.map((item) => item.deptCode), ["002", "003"]);
  assert.equal(local.defaultKey, "2");
  assert.equal(local.tree[0].key, "2");
  assert.equal(local.tree[0].children[0].key, "3");
  assert.equal(root.options.length, 4);
  assert.equal(root.defaultKey, "");
  const query = buildWarningQuery("stationDailyHb30", "station", emptyFilters(), 1, 20, local);
  assert.equal(query.deptCode, "002");
  assert.equal(query.deptName, "分局");
  assert.throws(() => buildWarningQuery("stationDailyHb30", "station", { ...emptyFilters(), deptKey: "4" }, 1, 20, local), /部门范围/);
});

test("unresolved non-root identity cannot silently issue an unrestricted station query", () => {
  const missing = departmentScope(departments, { unit_code: "missing", is_root_department: false });
  assert.deepEqual(missing.options, []);
  assert.throws(() => buildWarningQuery("stationDailyHb30", "station", emptyFilters(), 1, 20, missing), /部门范围/);
  assert.equal(buildWarningQuery("stationDailyHb30", "station", emptyFilters(), 1, 20, root).deptCode, undefined);
});

test("query contracts include only the selected model's filters", () => {
  const filters = { ...emptyFilters("2"), beginDate: "2026-01-01", endDate: "2026-01-31", bjlxdm: "01", keyword: "  关键词  ", deptName: "  派出所  ", minTotalCnt: "3" };
  const type = buildWarningQuery("type3dayRise", "type_rise", filters, 2, 50, local);
  assert.equal(type.bjlxdm, "01");
  assert.equal(type.keyword, undefined);
  assert.equal(type.minTotalCnt, undefined);
  assert.equal(type.pageNum, 2);
  assert.equal(type.pageSize, 50);
  const station = buildWarningQuery("stationMonthlyTb30", "station", filters, 1, 20, local);
  assert.equal(station.keyword, "关键词");
  assert.equal(station.deptName, "分局");
  assert.equal(station.bjlxdm, undefined);
  const person = buildWarningQuery("repeatPerson90d", "person", filters, 1, 20, local);
  assert.equal(person.deptName, "派出所");
  assert.equal(person.minTotalCnt, 3);
  assert.equal(person.deptCode, undefined);
  for (const kind of ["station_alarm", "community_alarm"]) {
    const area = buildWarningQuery("dynamicRule", kind, filters, 1, 20, local);
    assert.equal(area.keyword, "关键词");
    assert.equal(area.deptName, undefined);
    assert.equal(area.minTotalCnt, undefined);
  }
  assert.throws(() => buildWarningQuery("repeatPerson90d", "person", { ...filters, minTotalCnt: "0" }, 1, 20, local), /正整数/);
  assert.throws(() => buildWarningQuery("type3dayRise", "type_rise", { ...filters, endDate: "2025-01-01" }, 1, 20, local), /开始日期/);
});

test("daily and weekly detail columns preserve null vs zero and all growth periods", () => {
  const row = { bjlxdm: "01", day1Date: "2026-01-01", day1Cnt: 0, day2Cnt: null, day3Cnt: 4, day4Cnt: 6, day2GrowthRate: null, day3GrowthRate: 0, day4GrowthRate: 50 };
  const bars = trendBars(row, "type3dayRise", "type_rise");
  assert.deepEqual(bars.map((bar) => bar.count), [0, 0, 4, 6]);
  assert.deepEqual(bars.map((bar) => bar.growth), [null, null, 0, 50]);
  const fields = detailFields(row, "type3dayRise", "type_rise");
  assert.equal(fields.length, 8);
  assert.equal(fields[0].value, "类型01（代码 01）");
  assert.match(fields[1].value, /0 起/);
  assert.equal(fields[2].value, "- - 起");
  assert.equal(fields[6].value, "0.00%");
  assert.equal(fields[7].value, "+50.00%");
  assert.equal(detailFields({ week1Start: "2026-01-05", week1Cnt: 2 }, "type2weekRise", "type_rise")[1].value, "2026-01-05起 2 起");
});

test("year-on-year models use previous-year counts, not previous-month counts", () => {
  const row = { monthStart: "2026-03-01", prevYearCnt: 10, prevCnt: 20, cnt: 30, growthRate: 200 };
  assert.equal(previousCount(row, "stationMonthlyTb30"), 10);
  const bars = trendBars(row, "stationMonthlyTb30", "station");
  assert.equal(bars[0].label, "去年同期");
  assert.equal(bars[0].count, 10);
  const fields = detailFields(row, "stationMonthlyTb30", "station");
  assert.equal(fields[1].value, "2026年03月");
  assert.equal(fields[2].value, "10 起");
  assert.equal(fields[4].label, "同比上升");
});

test("dynamic area rules use server trends; only the last bar has growth", () => {
  const row = { areaCode: "a", alarmType: "报警", periodStart: "2026-03-01", growthRate: 50, trend: [{ date: "2026-02-01", count: 2 }, { date: "2026-03-01", count: 3 }] };
  assert.equal(rowKey(row, "dynamicRule"), "a|报警|2026-03-01");
  assert.deepEqual(trendBars(row, "dynamicRule", "community_alarm").map((bar) => bar.growth), [null, 50]);
  assert.equal(detailFields(row, "dynamicRule", "community_alarm")[0].label, "社区");
  assert.deepEqual(trendBars({}, "dynamicRule", "community_alarm"), []);
});

test("person data preserves backend masking and parses original department separators", () => {
  const row = { lxdh: "138****1234", personName: "张*", deptNames: "甲,乙，丙、丁;戊；己" };
  assert.equal(rowKey(row, "repeatPerson90d"), "138****1234");
  assert.equal(detailFields(row, "repeatPerson90d", "person")[1].value, "138****1234");
  assert.deepEqual(personDeptTags(row), ["甲", "乙", "丙", "丁", "戊", "己"]);
  assert.deepEqual(trendBars(row, "repeatPerson90d", "person"), []);
  assert.equal(fmtGrowth(null), "-");
  assert.equal(fmtGrowth(-3), "-3.00%");
});

test("pagination remains bounded and keeps first, last and neighboring pages", () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(10, 20), [1, 8, 9, 10, 11, 12, 20]);
  assert.deepEqual(pageNumbers(20, 20), [1, 18, 19, 20]);
});
