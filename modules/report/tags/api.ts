import { apiDelete, apiGet, apiPost, apiPut, downloadReport } from '../api/client'

interface DataEnvelope<T> { data: T }
const wrapData = <T>(data: T): DataEnvelope<T> => ({ data })
function buildQuery(params?: Record<string, unknown>) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const text = query.toString()
  return text ? `?${text}` : ''
}

export interface TagV2DictItem {
  id: string
  tagCode: string
  domain: string
  level1?: string
  level2?: string
  level3?: string
  level4?: string
  tagPath: string
  tagRule?: string
  method?: string
  name: string
  category: string
  /** 标签来源：治安标签池为 'zj'，前科标签为 'prior'，tag_dict_v2 无此字段 */
  source?: string
  /** 人员外部标签关联人数 */
  personCount?: number
}

export interface TagV2ResultItem {
  id?: number
  tagCode: string
  tagPath: string
  domain: string
  source: string
  confidence?: number | null
  evidence?: string | null
  batch?: string | null
  tagRule?: string | null
  method?: string | null
  createTime?: string | null
  name: string
}

export interface TagV2PersonTagItem {
  id?: number
  tagCode?: string | null
  tagPath: string
  source?: string | null
  enrichStatus?: string | null
  evidence?: string | null
  batch?: string | null
  createTime?: string | null
  name?: string
}

export interface TagV2PersonItem {
  idNo?: string | null
  personName?: string | null
  phone?: string | null
  personRole: string
  personRoleLabel?: string
  enrichStatus?: string | null
  tags: TagV2PersonTagItem[]
  zjTags?: TagV2PersonTagItem[]
  priorTags?: TagV2PersonTagItem[]
}

export interface TagV2AlarmRow {
  id: string
  fkdbh: string
  cjdbh?: string | null
  jjdbh?: string | null
  /** 警情小类代码（zd_bjlxdm.bjlxdm）：判断是否涉黄涉赌（需脱敏）的依据之一 */
  bjlxdm?: string | number | null
  /** 是否需脱敏（后端判定：警情小类或反馈类别/类型/细类涉黄涉赌），前端用 isRowSensitive 消费 */
  sensitive?: boolean | null
  bjsj?: string | null
  fkdwmc?: string | null
  fkdwdm?: string | null
  zrmj?: string | null
  fkrxm?: string | null
  cjqk?: string | null
  jqqh?: string | null
  jqxz?: string | null
  czyj?: string | null
  tagCount?: number
  personCount?: number
  manualVerified?: boolean
  lastTagTime?: string | null
  tags?: TagV2ResultItem[]
  persons?: TagV2PersonItem[]
}

export interface TagV2Catalog {
  domains: string[]
  tags: TagV2DictItem[]
  dataRange?: {
    beginTime?: string | null
    endTime?: string | null
    alarmCount?: number
  }
}

export interface TagV2SearchPayload {
  tags?: string[]
  /** 标签组合逻辑：'and'/'or'（legacy）或 JSON 组串（如 {"groups":[["a","b","c"],["d"]],"join":"or"}） */
  logic?: string
  domain?: string
  fkdbh?: string
  cjdbh?: string
  fkdwmc?: string
  fkdwdm?: string
  fkrxm?: string
  keyword?: string
  beginTime?: string
  endTime?: string
  hasManual?: boolean
  ajlbCodes?: string[]
  ajlxCodes?: string[]
  ajxlCodes?: string[]
  pageNum?: number
  pageSize?: number
}

export interface TagV2SearchResult {
  rows: TagV2AlarmRow[]
  total: number
  pageNum?: number
  pageSize?: number
  peopleTotal?: number | null
  stationTotal?: number | null
  exactTotal?: boolean
  hasMore?: boolean
}

/** 研判包标签项（v2：存 tag_dict_v2 全路径，旧包 tagPath 可为空） */
export interface TagV2PackageTag {
  id: string
  name: string
  tagPath?: string
  category?: string
  source?: string
  description?: string
}

export interface TagV2PackageCondition {
  unit: 'single' | 'groups'
  match: 'all' | 'any'
  groups: string[][]
}

export interface TagV2Package {
  id: string
  name: string
  createdAt: string
  remark: string
  tags: TagV2PackageTag[]
  /** 后端查询兼容字段 */
  logic?: string
  /** 研判包组合的权威显示结构 */
  condition?: TagV2PackageCondition
  preset?: boolean
}

export async function listTagV2Packages(keyword?: string): Promise<DataEnvelope<TagV2Package[]>> {
  const query = buildQuery({ keyword })
  const data = await apiGet<TagV2Package[]>(`/tags/packages${query}`)
  return wrapData(data)
}

export async function saveTagV2Package(data: {
  name: string
  remark?: string
  tags: TagV2PackageTag[]
  logic?: string
  condition?: TagV2PackageCondition
}): Promise<DataEnvelope<{ id: string }>> {
  const result = await apiPost<{ id: string }>('/tags/packages', data)
  return wrapData(result)
}

export async function updateTagV2Package(
  id: string,
  data: { name: string; remark?: string; tags: TagV2PackageTag[]; logic?: string; condition?: TagV2PackageCondition },
): Promise<DataEnvelope<{ id: string }>> {
  const result = await apiPut<{ id: string }>(`/tags/packages/${encodeURIComponent(id)}`, data)
  return wrapData(result)
}

export async function deleteTagV2Package(id: string): Promise<DataEnvelope<unknown>> {
  const result = await apiDelete(`/tags/packages/${encodeURIComponent(id)}`)
  return wrapData(result)
}

export interface TagV2ExportPayload {
  tags?: string[]
  /** 标签组合逻辑：and=同时命中全部标签，or=命中任一标签 */
  logic?: string
  domain?: string
  fkdbh?: string
  cjdbh?: string
  fkdwmc?: string
  fkdwdm?: string
  fkrxm?: string
  keyword?: string
  beginTime?: string
  endTime?: string
  hasManual?: boolean
  ajlbCodes?: string[]
  ajlxCodes?: string[]
  ajxlCodes?: string[]
  selectedIds?: string[]
  exportType?: 'alarms' | 'people'
  limit?: number
}

export async function exportTagV2Alarms(data: TagV2ExportPayload, filename: string): Promise<void> {
  return downloadReport('/tags-v2/export', {
      tags: data.tags || [],
      logic: data.logic || 'and',
      domain: data.domain || undefined,
      fkdbh: data.fkdbh || undefined,
      cjdbh: data.cjdbh || undefined,
      fkdwmc: data.fkdwmc || undefined,
      fkdwdm: data.fkdwdm || undefined,
      fkrxm: data.fkrxm || undefined,
      keyword: data.keyword || undefined,
      beginTime: data.beginTime || undefined,
      endTime: data.endTime || undefined,
      hasManual: typeof data.hasManual === 'boolean' ? data.hasManual : undefined,
      ajlbCodes: data.ajlbCodes || undefined,
      ajlxCodes: data.ajlxCodes || undefined,
      ajxlCodes: data.ajxlCodes || undefined,
      selectedIds: data.selectedIds && data.selectedIds.length ? data.selectedIds : undefined,
      exportType: data.exportType || 'alarms',
      limit: data.limit || 20000,
    }, filename)
}

export type TagV2StatsLevel = '1' | '2' | '3' | '4' | 'combo'

export interface TagV2StatsItem {
  label: string
  pathPrefix: string
  alarmCount: number
  hitCount: number
}

export interface TagV2StatsResult {
  level: TagV2StatsLevel | string
  totalAlarms: number
  items: TagV2StatsItem[]
}

function buildTagV2QueryParams(data: TagV2SearchPayload) {
  return {
    tags: (data.tags || []).join(',') || undefined,
    logic: data.logic || 'and',
    domain: data.domain || undefined,
    fkdbh: data.fkdbh || undefined,
    cjdbh: data.cjdbh || undefined,
    fkdwmc: data.fkdwmc || undefined,
    fkdwdm: data.fkdwdm || undefined,
    fkrxm: data.fkrxm || undefined,
    keyword: data.keyword || undefined,
    beginTime: data.beginTime || undefined,
    endTime: data.endTime || undefined,
    hasManual: typeof data.hasManual === 'boolean' ? data.hasManual : undefined,
    ajlb: (data.ajlbCodes || []).join(',') || undefined,
    ajlx: (data.ajlxCodes || []).join(',') || undefined,
    ajxl: (data.ajxlCodes || []).join(',') || undefined,
  }
}

export async function listTagV2Catalog(domain?: string): Promise<DataEnvelope<TagV2Catalog>> {
  const query = buildQuery(domain && domain !== '全部' ? { domain } : undefined)
  const data = await apiGet<TagV2Catalog>(`/tags-v2/catalog${query}`)
  return wrapData(data)
}

export async function statsTagV2Alarms(
  data: TagV2SearchPayload & { level?: TagV2StatsLevel; limit?: number },
): Promise<DataEnvelope<TagV2StatsResult>> {
  const query = buildQuery({
    ...buildTagV2QueryParams(data),
    level: data.level || '1',
    limit: data.limit || 500,
  })
  const result = await apiGet<TagV2StatsResult>(`/tags-v2/stats${query}`)
  return wrapData(result)
}

export async function searchTagV2Alarms(
  data: TagV2SearchPayload,
): Promise<DataEnvelope<TagV2SearchResult>> {
  const query = buildQuery({
    ...buildTagV2QueryParams(data),
    pageNum: data.pageNum || 1,
    pageSize: data.pageSize || 20,
  })
  const result = await apiGet<TagV2SearchResult>(`/tags-v2/search${query}`, undefined, { timeout: 120000 })
  return wrapData(result)
}

export async function getTagV2AlarmDetail(fkdbh: string): Promise<DataEnvelope<TagV2AlarmRow>> {
  const data = await apiGet<TagV2AlarmRow>(`/tags-v2/alarms/${encodeURIComponent(fkdbh)}`)
  return wrapData(data)
}

export async function verifyTagV2Alarm(data: {
  fkdbh: string
  tagPaths: string[]
}): Promise<DataEnvelope<TagV2AlarmRow>> {
  const result = await apiPut<TagV2AlarmRow>('/tags-v2/alarms/verify', data)
  return wrapData(result)
}

export function groupTagsByDomain(tags: TagV2ResultItem[] | undefined | null) {
  const grouped = new Map<string, TagV2ResultItem[]>()
  ;(tags || []).forEach((tag) => {
    const domain = String(tag.domain || '未分类').trim() || '未分类'
    const list = grouped.get(domain) || []
    list.push(tag)
    grouped.set(domain, list)
  })
  return [...grouped.entries()].map(([domain, items]) => ({ domain, items }))
}

const PERSON_ROLE_LABELS: Record<string, string> = {
  bjr: '报警人',
  sxr: '涉事人',
  shr: '受害人',
  xyr: '嫌疑人',
  qtr: '其他人员',
}

export function personRoleLabel(role?: string | null) {
  const key = String(role || '').trim().toLowerCase()
  return PERSON_ROLE_LABELS[key] || String(role || '').trim() || '涉警人员'
}

export function enrichStatusLabel(status?: string | null) {
  const map: Record<string, string> = {
    '0': '标签待补全',
    '1': '已补全',
    '2': '无命中',
    '9': '补全失败',
  }
  return map[String(status || '0')] || '标签待补全'
}

export function personDisplayName(person: TagV2PersonItem) {
  return String(person.personName || person.idNo || '未知').trim() || '未知'
}

export function personTagLeaf(tag: TagV2PersonTagItem) {
  const path = String(tag.tagPath || '').trim()
  return tag.name || path.split('/').filter(Boolean).pop() || path || '-'
}

export function isZjPersonTag(tag: TagV2PersonTagItem) {
  const source = String(tag.source || '').trim().toLowerCase()
  if (source === 'zj-api' || source === 'third_party') return true
  return String(tag.tagPath || '').startsWith('治安标签/')
}

export function personExtractTags(person: TagV2PersonItem) {
  return (person.tags || []).filter((tag) => !isZjPersonTag(tag))
}

export function personZjTags(person: TagV2PersonItem) {
  if (person.zjTags?.length) return person.zjTags
  return (person.tags || []).filter((tag) => isZjPersonTag(tag))
}

export function personPriorTags(person: TagV2PersonItem) {
  return person.priorTags || []
}
