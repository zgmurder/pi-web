/** 将后端时间格式化为本地可读字符串（东八区环境即本地墙钟）。 */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : parseApiDateTime(value)
  if (!date || Number.isNaN(date.getTime())) {
    return String(value).replace('T', ' ').replace(/\.\d+$/, '').slice(0, 19)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 解析接口时间：
 * - 带 Z / ±08:00 的按标准解析
 * - 无时区字符串按东八区墙钟处理（与 MySQL session +08:00 一致）
 */
export function parseApiDateTime(value: string): Date | null {
  let raw = String(value).trim()
  if (!raw) return null
  raw = raw.replace(' ', 'T')
  raw = raw.replace(/(\.\d{3})\d+/, '$1')
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    raw = `${raw}+08:00`
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}
