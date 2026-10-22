import type { TagV2AlarmRow, TagV2DictItem, TagV2Package, TagV2PackageCondition, TagV2PackageTag } from './api'

export const tagValue = (tag: TagV2PackageTag) => String(tag.tagPath || tag.name || '').trim()
export const rowKey = (row?: TagV2AlarmRow | null) => String(row?.fkdbh || row?.id || '').trim()
export const sourceLabel = (source?: string | null) => ({ llm: 'AI', rule: '规则', map: '映射', manual: '人工' }[source || ''] || source || '-')
export function htmlToPlainText(html?: string | null) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+\n/g, '\n').trim()
}
export function splitAlarmContentBlocks(text: string) {
  const blocks = text.split(/(?=【[^】]{1,20}】)/).map(s => s.trim()).filter(Boolean)
  const index = blocks.findIndex(s => s.startsWith('【警情内容及处置情况】'))
  if (index < 0) return { blocks, highlightIndex: -1 }
  const [target] = blocks.splice(index, 1)
  const highlightIndex = Math.min(2, blocks.length)
  blocks.splice(highlightIndex, 0, target)
  return { blocks, highlightIndex }
}
export function uniqueTags(groups: TagV2PackageTag[][]) {
  const seen = new Set<string>()
  return groups.flat().filter(tag => { const key = tagValue(tag); if (!key || seen.has(key)) return false; seen.add(key); return true })
}
export function makeCondition(unit: 'single' | 'groups', match: 'all' | 'any', groups: TagV2PackageTag[][]): TagV2PackageCondition {
  const tags = uniqueTags(groups)
  const paths = (unit === 'single' ? [tags] : groups).map(group => group.map(tagValue).filter(Boolean)).filter(group => group.length)
  return { unit: tags.length === 1 ? 'single' : unit, match: tags.length === 1 ? 'any' : match, groups: paths }
}
export function conditionLogic(condition: TagV2PackageCondition) {
  const join = condition.match === 'any' ? 'or' : 'and'
  return condition.unit === 'single' ? join : JSON.stringify({ join, groups: condition.groups })
}
export function packageCondition(item: TagV2Package): { unit: 'single' | 'groups'; match: 'all' | 'any'; groups: TagV2PackageTag[][] } {
  const byPath = new Map(item.tags.map(tag => [tagValue(tag), tag]))
  let condition = item.condition
  if (!condition) {
    try {
      const parsed = JSON.parse(item.logic || '')
      if (Array.isArray(parsed.groups)) condition = { unit: 'groups', match: parsed.join === 'and' ? 'all' : 'any', groups: parsed.groups }
    } catch { /* legacy and/or */ }
  }
  if (condition?.unit === 'groups') {
    const groups = condition.groups.map(group => group.map(path => byPath.get(path)).filter((tag): tag is TagV2PackageTag => Boolean(tag))).filter(group => group.length)
    if (groups.length) return { unit: 'groups', match: condition.match, groups }
  }
  return { unit: 'single', match: condition?.match || (item.logic === 'or' ? 'any' : 'all'), groups: [item.tags] }
}
export function relationLabel(item: TagV2Package) {
  const condition = item.condition || (item.tags.length === 1 ? { unit: 'single', match: 'any' } : packageCondition(item))
  return `${condition.unit === 'groups' ? '多组' : '单个'}·${condition.match === 'all' ? '全部满足' : condition.unit === 'groups' ? '满足任意组' : '满足任意一个'}`
}
export function levelOptions(tags: TagV2DictItem[], level: 1 | 2 | 3, parent = '') {
  const options = new Map<string, string>()
  tags.forEach(tag => {
    const parts = [tag.level1, tag.level2, tag.level3].slice(0, level).map(value => String(value || '').trim())
    if (parts.some(value => !value)) return
    const path = parts.join('/')
    if (parent && !path.startsWith(parent + '/')) return
    options.set(path, parts[parts.length - 1])
  })
  return [...options].map(([value, label]) => ({ value, label }))
}
export function dataDayRange(minTime?: string | null, maxTime?: string | null, lastOnly = false): [string, string] | null {
  const min = new Date(String(lastOnly ? maxTime || '' : minTime || '').replace(' ', 'T'))
  const max = new Date(String(maxTime || '').replace(' ', 'T'))
  if (!Number.isFinite(+min) || !Number.isFinite(+max)) return null
  min.setHours(0, 0, 0, 0); max.setHours(0, 0, 0, 0); max.setDate(max.getDate() + 1)
  const format = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 00:00:00`
  return [format(min), format(max)]
}
export function rangesOverlap(a: string, b: string, c?: string | null, d?: string | null) {
  const ms = (s?: string | null) => Date.parse(String(s || '').replace(' ', 'T'))
  return ms(a) < ms(d) && ms(c) < ms(b)
}
