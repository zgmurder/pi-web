import { apiGet, apiPost, downloadReport } from '../api/client'

export interface PoliceEventQuery {
  start_time?: string
  end_time?: string
  feedback_start_time?: string
  feedback_end_time?: string
  alarm_no?: string
  feedback_no?: string
  phone?: string
  keyword?: string
  address?: string
  jq_keyword?: string
  content_max_len?: number
  feedback_keyword?: string
  event_type?: string
  category_code?: string
  type_code?: string
  detail_code?: string
  handle_types?: string[]
  alarm_type?: string
  alarm_method?: string
  jj_unit_code?: string
  handle_unit_code?: string
  hour_start?: string
  hour_end?: string
  district_code?: string
  district_include_sub?: boolean
  org_category?: string
  feedback_category_code?: string
  feedback_type_code?: string
  feedback_detail_code?: string
  unit_code?: string
  community?: string
  officer?: string
  // 反馈单扩展过滤（对齐旧系统反馈单查询）
  community_code?: string
  street_code?: string
  complex_code?: string
  foreign_related?: string
  on_scene?: string
  evidence_collected?: string
  final_feedback_start_time?: string
  final_feedback_end_time?: string
  feedback_max_len?: number
  feedback_finished?: string
  // 标签查询（jjd_jjd.jqgjz 逗号分隔标签名；多选=命中任一）
  tag_names?: string[]
  page: number
  page_size: number
}

export interface PoliceTagOption {
  name: string
  count: number
  /** 与该标签共现≥2 次的子标签（按共现次数降序），供大类→小类级联 */
  children?: string[]
}

export interface PoliceEventRow {
  id: string
  alarm_no?: string | null
  feedback_no?: string | null
  alarm_time?: string | null
  feedback_time?: string | null
  alarm_phone?: string | null
  contact_phone?: string | null
  receive_unit?: string | null
  alarm_method?: string | null
  alarm_type?: string | null
  handle_type?: string | null
  category_name?: string | null
  event_type?: string | null
  detail_name?: string | null
  unit_name?: string | null
  community?: string | null
  officer?: string | null
  address?: string | null
  summary?: string | null
  feedback?: string | null
  handle_result?: string | null
  final_category_name?: string | null
  final_type_name?: string | null
  final_detail_name?: string | null
  final_feedback?: string | null
  jq_tags?: string | null
  sensitive?: boolean
}

export interface PoliceEventExportQuery extends PoliceEventQuery {
  export_scope?: 'page' | 'all'
  fields?: string[]
  max_rows?: number
}

export function exportPoliceEvents(query: PoliceEventExportQuery) {
  return downloadReport('/police-events/export', query, '警情查询.xlsx')
}

export function searchPoliceEvents(query: PoliceEventQuery) {
  return apiPost<{ total: number; page: number; page_size: number; items: PoliceEventRow[]; notes?: string[] }>('/police-events/search', query)
}

export interface PoliceCommunityOption {
  code: string
  name: string
}

export function getPoliceCommunityOptions() {
  return apiGet<PoliceCommunityOption[]>('/police-events/community-options')
}

export interface PoliceStreetOption {
  code: string
  name: string
}

export function getPoliceStreetOptions() {
  return apiGet<PoliceStreetOption[]>('/police-events/street-options')
}

export function getPoliceTagOptions() {
  return apiGet<PoliceTagOption[]>('/police-events/tag-options')
}

// ---------- 接警/反馈统计 ----------

export type Police110StatKey =
  | 'total' | 'valid' | 'directive' | 'dup' | 'direct' | 'joint'
  | 'call_in' | 'call_valid' | 'early_in' | 'early_cb' | 'early_rate' | 'short_conn'

export interface Police110StatsParams {
  source: 'jjd' | 'fkd'
  unit_code?: string | null
  start_time: string
  end_time: string
  level: 'city' | 'l1' | 'l2'
  compare: string[]
  alarm_method?: string | null
  include_alarm_method?: boolean
  alarm_type?: string | null
  include_alarm_type?: boolean
  category_codes?: string[]
  include_category?: boolean
  type_codes?: string[]
  include_type?: boolean
  detail_codes?: string[]
  include_detail?: boolean
  feedback_category_code?: string | null
  include_feedback_category?: boolean
  feedback_type_code?: string | null
  include_feedback_type?: boolean
  feedback_detail_code?: string | null
  include_feedback_detail?: boolean
  place_category_code?: string | null
  include_place_category?: boolean
  place_type_code?: string | null
  include_place_type?: boolean
}

export interface Police110CategoryOption {
  code: string
  name: string
  parentCode?: string | null
  level: 'category' | 'type' | 'subtype'
  children: Police110CategoryOption[]
}

export function getPolice110CategoryOptions() {
  return apiGet<Police110CategoryOption[]>('/police-events/110-stats/category-options')
}

export function getPolice110FeedbackCategoryOptions() {
  return apiGet<Police110CategoryOption[]>('/police-events/110-stats/feedback-category-options')
}

export interface Police110PlaceOption {
  code: string
  name: string
  children: Police110PlaceOption[]
}

export function getPolice110PlaceOptions() {
  return apiGet<Police110PlaceOption[]>('/police-events/110-stats/place-options')
}

export interface Police110DimensionValue {
  key: string
  label: string
  value: number
}

export interface Police110StatRow {
  unit_code: string
  unit_name: string
  dimensions?: Police110DimensionValue[]
  total: number
  valid: number
  directive: number
  dup: number
  direct: number
  joint: number
  call_in: number
  call_valid: number
  early_in: number
  early_cb: number | null
  early_rate: number | null
  short_conn: number
  yoy?: Partial<Record<Police110StatKey, number>> | null
  mom?: Partial<Record<Police110StatKey, number>> | null
}

export interface Police110StatsResult {
  source: 'jjd' | 'fkd'
  level: 'city' | 'l1' | 'l2'
  unit_code: string
  start_time: string
  end_time: string
  compare: string[]
  dimension_columns?: Police110DimensionValue[]
  rows: Police110StatRow[]
  total_row: Police110StatRow
  base_notes?: Record<string, string>
}

export function postPolice110Stats(data: Police110StatsParams) {
  return apiPost<Police110StatsResult>('/police-events/110-stats', data)
}

export function exportPolice110Stats(data: Police110StatsParams) {
  return downloadReport('/police-events/110-stats/export', data, '警情统计.xlsx')
}
