import type { Police110CategoryOption, Police110PlaceOption, Police110StatKey, Police110StatRow, Police110StatsParams, PoliceEventQuery } from './api'
import { formatDateTime } from './datetime'

export type Option = { label: string; value: string }
export const options = (items: [string, string][]): Option[] => items.map(([label, value]) => ({ label, value }))
export const districts = options([['金华市','330700'],['婺城区','330702'],['金东区','330703'],['武义县','330723'],['浦江县','330726'],['永康市','330727'],['东阳市','330783'],['义乌市','330782'],['兰溪市','330784']])
export const alarmMethods = options([['110报警','110'],['122报警','122'],['119报警','119'],['120报警','120'],['自接警','self'],['12122报警','12122'],['12345转接','12345'],['12110报警','12110'],['其它报警','other'],['12356转单','12356']])
export const handleTypes = options([['派单处置','10'],['口头答复','11'],['短信回复','12'],['重复警情','3'],['骚扰电话','5'],['其他无效警情','13'],['其他','9']])
export const alarmTypes = options([['110报警','1'],['122报警','2'],['119报警','3'],['自接警','5'],['其他','9']])
export const orgCategories = options([['指挥中心','center'],['派出所','station'],['交警','traffic'],['大队','brigade'],['其他','other']])
export const statsAlarmMethods = options([['电话报警','1'],['物联网报警','2'],['短信报警','3'],['其他','9'],['口头报警','10'],['投案自首','11'],['工作发现','12'],['5G视频报警','13'],['扭送现行','14'],['其他政府部门移送','16'],['警情反馈','17'],['互联网自助报警','20']])
export const statsAlarmTypes = options([['110报警','1'],['122报警','2'],['119报警','3'],['120报警','4'],['自接警','5'],['12122报警','6'],['12345转接','7'],['12110报警','8'],['其它报警','9'],['12356转单','10']])
export const TAG_KEYS = ['tag_category','tag_major','tag_minor','tag_fine','tag_other1','tag_other2','tag_content'] as const
export const TAG_LABELS = ['标签类别','标签大类','标签小类','标签细类','其他标签1','其他标签2','内容标签']
export type QueryTab = 'alarm' | 'feedback' | 'tag'
export type QuickKind = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth'
export const QUICK_LABELS: [QuickKind,string][] = [['today','今天'],['yesterday','昨天'],['week','本周'],['lastWeek','上周'],['month','本月'],['lastMonth','上月']]
export type Range = [string, string]
export function inputDate(date: Date) { return formatDateTime(date).replace(' ', 'T') }
export function queryQuick(kind: QuickKind, now = new Date()): Range {
  const start = new Date(now); start.setHours(0,0,0,0)
  if (kind === 'yesterday') start.setDate(start.getDate()-1)
  else if (kind === 'week') start.setDate(start.getDate()-((start.getDay()+6)%7))
  else if (kind === 'lastWeek') start.setDate(start.getDate()-(start.getDay()||7)-6)
  else if (kind === 'month') start.setDate(1)
  else if (kind === 'lastMonth') { start.setDate(1); start.setMonth(start.getMonth()-1) }
  // Intentional original behavior: 本周 / 本月 select their first day, not week/month-to-date.
  const end = new Date(start)
  if (kind === 'lastWeek') end.setDate(end.getDate()+6)
  else if (kind === 'lastMonth') end.setMonth(end.getMonth()+1,0)
  end.setHours(23,59,59,0)
  return [inputDate(start), inputDate(end)]
}
export function statsQuick(kind: 'today' | 'yesterday' | 'week', now = new Date()): Range {
  const end = new Date(now), start = new Date(now); start.setHours(0,0,0,0)
  if (kind === 'yesterday') { end.setHours(0,0,0,0); start.setDate(start.getDate()-1) }
  if (kind === 'week') start.setDate(start.getDate()-6)
  return [inputDate(start), inputDate(end)]
}
export function defaultDistrict(root?: string) { const code = (root || '').trim().slice(0,6); return districts.some(o => o.value===code) ? code : '' }
export type QueryForm = {
  values: Record<string,string>; alarmRange: Range; feedbackRange: Range; finalFeedbackRange: Range;
  handle_types: string[]; district_include_sub: boolean; page: number; page_size: number;
}
export function newQueryForm(root = '', defaults = true): QueryForm {
  const now = new Date(), yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1); yesterday.setHours(0,0,0,0)
  return { values: { district_code: defaultDistrict(root) }, alarmRange: defaults ? [inputDate(yesterday), inputDate(now)] : ['',''], feedbackRange:['',''], finalFeedbackRange:['',''], handle_types:[], district_include_sub:false, page:1, page_size:20 }
}
export function queryPayload(form: QueryForm, tab: QueryTab): PoliceEventQuery {
  const values = Object.fromEntries(Object.entries(form.values).filter(([key,value]) => !TAG_KEYS.includes(key as typeof TAG_KEYS[number]) && value.trim()).map(([key,value]) => [key, value.trim()]))
  const stamp = (v: string) => v ? v.replace('T',' ').padEnd(19, ':00') : undefined
  return { ...values, start_time:stamp(form.alarmRange[0]), end_time:stamp(form.alarmRange[1]),
    feedback_start_time:tab==='feedback' ? stamp(form.feedbackRange[0]) : undefined,
    feedback_end_time:tab==='feedback' ? stamp(form.feedbackRange[1]) : undefined,
    final_feedback_start_time:tab==='feedback' ? stamp(form.finalFeedbackRange[0]) : undefined,
    final_feedback_end_time:tab==='feedback' ? stamp(form.finalFeedbackRange[1]) : undefined,
    content_max_len:form.values.content_max_len ? Number(form.values.content_max_len) : undefined,
    feedback_max_len:form.values.feedback_max_len ? Number(form.values.feedback_max_len) : undefined,
    handle_types:form.handle_types.length ? form.handle_types : undefined,
    district_include_sub:form.values.district_code ? form.district_include_sub : undefined,
    tag_names:TAG_KEYS.map(k => form.values[k]?.trim()).filter((v): v is string => Boolean(v)), page:form.page,page_size:form.page_size }
}
export function classificationOptions(tree: Police110CategoryOption[]): Option[][] {
  const levels = {category:new Map<string,Option>(),type:new Map<string,Option>(),subtype:new Map<string,Option>()}
  const visit = (nodes: Police110CategoryOption[]) => nodes.forEach(n => { levels[n.level]?.set(n.code,{label:n.name,value:n.code}); visit(n.children || []) })
  visit(tree); return Object.values(levels).map(m => [...m.values()])
}
export function uniqueOptions(nodes: {code:string;name:string}[]): Option[] { return [...new Map(nodes.map(n => [n.code,{label:n.name,value:n.code}])).values()] }
export function incidentOptions(tree: Police110CategoryOption[], categories: string[], types: string[]): Option[][] {
  const categoryNodes = tree.filter(n => !categories.length || categories.includes(n.code))
  const typeNodes = categoryNodes.flatMap(n => n.children || [])
  return [uniqueOptions(tree), uniqueOptions(typeNodes), uniqueOptions(typeNodes.filter(n => !types.length || types.includes(n.code)).flatMap(n => n.children || []))]
}
export function dependentOptions(tree: Police110PlaceOption[], category: string, type = ''): Option[][] {
  const types = tree.filter(n => !category || n.code === category).flatMap(n => n.children || [])
  return [uniqueOptions(tree),uniqueOptions(types),uniqueOptions(types.filter(n => !type || n.code===type).flatMap(n => n.children || []))]
}
export const METRICS: [Police110StatKey,string][] = [['total','总警情量'],['valid','有效警情'],['directive','指令处置'],['dup','重复警情'],['direct','直连警情'],['joint','联动警情'],['call_in','总呼入量'],['call_valid','有效接警'],['early_in','呼入早释'],['early_cb','早释回拨'],['early_rate','早释率'],['short_conn','短接警量']]
export const CITY_CODE = '330783000000'
export function newStatsForm(): Police110StatsParams {
  const [start,end] = statsQuick('yesterday')
  return {source:'jjd',unit_code:CITY_CODE,start_time:start,end_time:end,level:'l1',compare:[], alarm_method:null,include_alarm_method:true,alarm_type:null,include_alarm_type:true,category_codes:[],include_category:true,type_codes:[],include_type:true,detail_codes:[],include_detail:true,feedback_category_code:null,include_feedback_category:true,feedback_type_code:null,include_feedback_type:true,feedback_detail_code:null,include_feedback_detail:true,place_category_code:null,include_place_category:true,place_type_code:null,include_place_type:true}
}
export const INCLUDE_PAIRS = [['alarm_method','include_alarm_method'],['alarm_type','include_alarm_type'],['category_codes','include_category'],['type_codes','include_type'],['detail_codes','include_detail'],['feedback_category_code','include_feedback_category'],['feedback_type_code','include_feedback_type'],['feedback_detail_code','include_feedback_detail'],['place_category_code','include_place_category'],['place_type_code','include_place_type']] as const
export function statsPayload(form: Police110StatsParams): Police110StatsParams {
  const result = {...form,start_time:form.start_time.replace('T',' '),end_time:form.end_time.replace('T',' ')}
  for (const [filter,include] of INCLUDE_PAIRS) if (!form[filter]?.length) result[include]=true
  return result
}
export function comparisonRate(unit: Police110StatRow, cmp: 'yoy' | 'mom', key: Police110StatKey): number | null {
  const current = unit[key], base = unit[cmp]?.[key]
  return current == null || base == null || base === 0 ? null : (current-base)/base*100
}
