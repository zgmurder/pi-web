/** Report api/warning.ts contracts; fields are a union of the registered models. */
export type WarningRuleKey = string;
export type WarningRuleKind = "type_rise" | "station" | "person" | "station_alarm" | "community_alarm";
export interface WarningRuleMeta { ruleKey: WarningRuleKey; label: string; description: string; kind: WarningRuleKind; total: number }
export interface WarningBjlxOption { code: string; name: string }
export interface WarningOptions { bjlxOptions: WarningBjlxOption[] }
export interface WarningRow {
  warningText?: string | null;
  bjlxdm?: string | null;
  bjlxName?: string | null;
  day1Date?: string | null;
  day1Cnt?: number | null;
  day2Date?: string | null;
  day2Cnt?: number | null;
  day3Date?: string | null;
  day3Cnt?: number | null;
  day4Date?: string | null;
  day4Cnt?: number | null;
  day2GrowthRate?: number | null;
  day3GrowthRate?: number | null;
  day4GrowthRate?: number | null;
  week1Start?: string | null;
  week1Cnt?: number | null;
  week2Start?: string | null;
  week2Cnt?: number | null;
  week3Start?: string | null;
  week3Cnt?: number | null;
  week2GrowthRate?: number | null;
  week3GrowthRate?: number | null;
  deptCode?: string | null;
  deptName?: string | null;
  statDate?: string | null;
  weekStart?: string | null;
  monthStart?: string | null;
  prevCnt?: number | null;
  prevYearCnt?: number | null;
  cnt?: number | null;
  growthRate?: number | null;
  lxdh?: string | null;
  personName?: string | null;
  totalCnt?: number | null;
  activeDays?: number | null;
  firstTime?: string | null;
  lastTime?: string | null;
  typeCnt?: number | null;
  typeCodes?: string | null;
  typeNames?: string | null;
  deptNames?: string | null;
  areaCode?: string | null;
  areaName?: string | null;
  alarmType?: string | null;
  periodStart?: string | null;
  currentCnt?: number | null;
  trend?: Array<{ date?: string | null; count?: number | null }>;
}
export interface WarningListQuery {
  ruleKey: WarningRuleKey;
  pageNum?: number;
  pageSize?: number;
  beginDate?: string;
  endDate?: string;
  keyword?: string;
  bjlxdm?: string;
  deptCode?: string;
  deptName?: string;
  minTotalCnt?: number;
}
export interface WarningListPage { rows: WarningRow[]; total: number; pageNum: number; pageSize: number; hasNext?: boolean }
export interface WarningFilters { bjlxdm: string; keyword: string; deptName: string; minTotalCnt: string; beginDate: string; endDate: string; deptKey: string }
export interface DepartmentItem { id: number; name: string; code: string; parent_id?: number | null; sort_order: number; children?: DepartmentItem[] }
export interface DeptOption { deptId: number; deptName: string; deptCode: string; parentId: number; orderNum: number }
export interface DeptNode { key: string; label: string; children?: DeptNode[] }
export interface WarningUser { unit_code?: string | null; department_name?: string | null; is_root_department: boolean }
export interface DepartmentScope { options: DeptOption[]; tree: DeptNode[]; defaultKey: string; isCityBureau: boolean }
