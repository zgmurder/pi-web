"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { buildDeptTreeOptions, type TreeOption } from './deptTree'
import type { Scope } from './scope'
import s from './tags.module.css'

export function Icon({ name }: { name: 'search' | 'plus' | 'reset' | 'download' | 'edit' | 'trash' | 'tags' | 'close' }) {
  const paths = { search: 'm21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', plus: 'M12 5v14M5 12h14', reset: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7', download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', edit: 'm16 3 5 5-12 12-6 1 1-6ZM14 5l5 5', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', tags: 'm20 13-7 7a2 2 0 0 1-3 0L2 12V2h10l8 8a2 2 0 0 1 0 3M7 7h.01', close: 'M6 6l12 12M6 18 18 6' }
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className={s.modal} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose() }}><header className={s.header}><h2 className={s.title} id={id}>{title}</h2><button className={s.button} aria-label="关闭" onClick={onClose}><Icon name="close" /></button></header><div className={s.modalBody}>{children}</div>{footer && <footer className={s.modalFooter}>{footer}</footer>}</dialog>
}
export interface Option { value: string; label: string }
export function MultiSelect({ label, options, value, onChange, allowCreate = false, width }: { label: string; options: Option[]; value: string[]; onChange: (value: string[]) => void; allowCreate?: boolean; width?: number }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus() } }
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const resize = () => setOpen(false)
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape, true); window.addEventListener('resize', resize); document.addEventListener('scroll', scroll, true)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); document.removeEventListener('scroll', scroll, true) }
  }, [open])
  const merged = [...options, ...value.filter(path => !options.some(option => option.value === path)).map(path => ({ value: path, label: path }))]
  const filtered = merged.filter(option => query.toLowerCase().split(/\s+/).every(word => `${option.label} ${option.value}`.toLowerCase().includes(word)))
  const toggle = (path: string) => onChange(value.includes(path) ? value.filter(v => v !== path) : [...value, path])
  const content = open && <div ref={menu} className={s.menu} style={position} id={id} role="group" aria-label={label}><input ref={search} className={`${s.control} ${s.full}`} aria-label={`搜索${label}`} placeholder="搜索名称 / 路径" value={query} onChange={event => setQuery(event.target.value)} /><div className={s.row}><button className={s.link} onClick={() => onChange([])}>清空选择</button><button className={`${s.link} ${s.end}`} onClick={() => { setOpen(false); button.current?.focus() }}>完成</button></div>{allowCreate && query.trim() && !merged.some(option => option.value === query.trim()) && <button className={s.link} onClick={() => { toggle(query.trim()); setQuery('') }}>添加「{query.trim()}」</button>}{filtered.map(option => <label key={option.value}><input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option.value)} /><span>{option.label}</span></label>)}{!filtered.length && <p className={s.muted}>未匹配到标签</p>}</div>
  // A dialog's top layer excludes body portals; mount its picker inside that dialog.
  const portalTarget = button.current?.closest('dialog') || (typeof document !== 'undefined' ? document.body : null)
  return <div className={s.multi} style={{ width }}><button ref={button} className={`${s.control} ${s.full}`} style={{ textAlign: 'left' }} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { const rect = button.current!.getBoundingClientRect(); setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 370)), left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)) }); setOpen(!open) }}>{value.length ? `${label} (${value.length})` : label}</button>{portalTarget && content && createPortal(content, portalTarget)}</div>
}
export function Select({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <select aria-label={label} className={s.control} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">{label}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
}
export function DepartmentSelect({ scope, value, onChange }: { scope: Scope | null; value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('')
  const nodes = buildDeptTreeOptions(scope?.depts || [])
  function flatten(items: TreeOption[], depth = 0): Option[] { return items.flatMap(item => [{ value: item.key, label: `${'　'.repeat(depth)}${item.label}` }, ...flatten(item.children || [], depth + 1)]) }
  const options = flatten(nodes).filter(option => !query || option.label.includes(query))
  return <div className={s.row}><input className={s.control} style={{ width: 95 }} aria-label="搜索部门" placeholder="搜索部门" value={query} onChange={event => setQuery(event.target.value)} /><select className={s.control} style={{ maxWidth: 180 }} aria-label="部门" disabled={!scope} value={value} onChange={event => onChange(event.target.value || scope?.defaultKey || '')}>{scope?.user.is_root_department ? <option value="">部门（全市）</option> : !value ? <option value="">{scope?.user.department_name || '部门加载中'}</option> : null}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
}
export function DateRange({ begin, end, onChange }: { begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const format = (value: string) => value ? value.replace('T', ' ') + (value.length === 16 ? ':00' : '') : ''
  return <div className={s.dates}><input className={s.control} aria-label="报警时间起" type="datetime-local" step="1" value={begin.replace(' ', 'T')} onChange={event => onChange(format(event.target.value), end)} /><input className={s.control} aria-label="报警时间止" type="datetime-local" step="1" value={end.replace(' ', 'T')} onChange={event => onChange(begin, format(event.target.value))} /></div>
}
export function Pagination({ page, size, total, exact = true, hasMore = false, busy, onPage, onSize }: { page: number; size: number; total: number; exact?: boolean; hasMore?: boolean; busy: boolean; onPage: (page: number) => void; onSize?: (size: number) => void }) {
  const count = exact ? Math.max(1, Math.ceil(total / size)) : page + (hasMore ? 1 : 0)
  return <div className={s.pagination}><span>{exact ? total ? `${(page - 1) * size + 1}-${Math.min(page * size, total)} / ${total} 条` : '0 条' : `第 ${page} 页`}</span><button className={s.button} aria-label="上一页" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>‹</button><span>{page} / {count}</span><button className={s.button} aria-label="下一页" disabled={busy || page >= count} onClick={() => onPage(page + 1)}>›</button>{onSize && <select className={s.control} aria-label="每页条数" value={size} disabled={busy} onChange={event => onSize(Number(event.target.value))}>{[10,20,50].map(n => <option key={n} value={n}>{n} 条/页</option>)}</select>}</div>
}
export const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
