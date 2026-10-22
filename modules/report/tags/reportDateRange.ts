/** 报告/标签页共用的时间范围快捷项 */

export type DateRangeShortcutKey =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'

export const DATE_RANGE_SHORTCUT_CACHE_KEY = 'intelligence:date-range-shortcut'
export const GLOBAL_PARAM_CACHE_KEY = 'report:global-params'

export const DATE_RANGE_SHORTCUTS: Array<{ key: DateRangeShortcutKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'thisQuarter', label: '本季度' },
]

const DATE_RANGE_SHORTCUT_KEYS = new Set(DATE_RANGE_SHORTCUTS.map((item) => item.key))

export const DATE_RANGE_SHORTCUT_MATCH_PRIORITY: DateRangeShortcutKey[] = [
  'thisQuarter',
  'lastMonth',
  'thisMonth',
  'lastWeek',
  'thisWeek',
  'yesterday',
  'today',
]

function readReportParamCache(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(GLOBAL_PARAM_CACHE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function formatDateTime(value?: number) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date) {
  const day = startOfDay(date)
  const weekday = day.getDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDays(day, offset)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

function startOfQuarter(date: Date) {
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3
  return new Date(date.getFullYear(), quarterMonth, 1, 0, 0, 0, 0)
}

export function resolveDateRangeShortcut(key: DateRangeShortcutKey, now = new Date()): [number, number] {
  const today = startOfDay(now)
  if (key === 'today') return [today.getTime(), now.getTime()]
  if (key === 'yesterday') {
    const yesterday = addDays(today, -1)
    return [yesterday.getTime(), today.getTime()]
  }
  if (key === 'thisWeek') return [startOfWeek(now).getTime(), now.getTime()]
  if (key === 'lastWeek') {
    const thisWeek = startOfWeek(now)
    return [addDays(thisWeek, -7).getTime(), thisWeek.getTime()]
  }
  if (key === 'thisMonth') return [startOfMonth(now).getTime(), now.getTime()]
  if (key === 'lastMonth') {
    const thisMonth = startOfMonth(now)
    const lastMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1, 0, 0, 0, 0)
    return [lastMonth.getTime(), thisMonth.getTime()]
  }
  return [startOfQuarter(now).getTime(), now.getTime()]
}

export function readCachedDateRangeShortcut(): DateRangeShortcutKey | '' {
  try {
    const raw = String(localStorage.getItem(DATE_RANGE_SHORTCUT_CACHE_KEY) || '').trim()
    return DATE_RANGE_SHORTCUT_KEYS.has(raw as DateRangeShortcutKey) ? (raw as DateRangeShortcutKey) : ''
  } catch {
    return ''
  }
}

export function persistDateRangeShortcut(key: DateRangeShortcutKey | '') {
  try {
    if (!key) {
      localStorage.removeItem(DATE_RANGE_SHORTCUT_CACHE_KEY)
      return
    }
    localStorage.setItem(DATE_RANGE_SHORTCUT_CACHE_KEY, key)
  } catch {
    /* ignore */
  }
}

export function syncTimeToReportCache(beginTime: string, endTime: string) {
  try {
    const data = readReportParamCache()
    const next = { ...data }
    const start = beginTime.trim()
    const end = endTime.trim()
    if (start && end) {
      next.date_start = start
      next.dateStart = start
      next.date_end = end
      next.dateEnd = end
    } else {
      delete next.date_start
      delete next.dateStart
      delete next.date_end
      delete next.dateEnd
    }
    localStorage.setItem(GLOBAL_PARAM_CACHE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

/** 读取报告页时间：优先快捷项重算，否则用缓存绝对时间 */
export function readReportDateRange(): {
  beginTime: string
  endTime: string
  shortcut: DateRangeShortcutKey | ''
} {
  const shortcut = readCachedDateRangeShortcut()
  if (shortcut) {
    const [start, end] = resolveDateRangeShortcut(shortcut)
    return {
      beginTime: formatDateTime(start),
      endTime: formatDateTime(end),
      shortcut,
    }
  }
  const cache = readReportParamCache()
  const beginTime = String(cache.date_start || cache.dateStart || '').trim()
  const endTime = String(cache.date_end || cache.dateEnd || '').trim()
  return { beginTime, endTime, shortcut: '' }
}

export function matchActiveDateRangeShortcut(beginTime: string, endTime: string): DateRangeShortcutKey | '' {
  if (!beginTime || !endTime) return ''
  const startMs = Date.parse(beginTime.replace(/-/g, '/'))
  const endMs = Date.parse(endTime.replace(/-/g, '/'))
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return ''
  const now = new Date()
  return (
    DATE_RANGE_SHORTCUT_MATCH_PRIORITY.find((key) => {
      const [start, end] = resolveDateRangeShortcut(key, now)
      const endTolerance =
        key === 'yesterday' || key === 'lastWeek' || key === 'lastMonth' ? 0 : 120_000
      return startMs === start && Math.abs(endMs - end) <= endTolerance
    }) || ''
  )
}
