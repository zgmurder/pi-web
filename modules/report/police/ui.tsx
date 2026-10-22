"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Option, Range } from './model'
import styles from './police.module.css'

export function Select({ label, value, options, onChange, multiple = false, placeholder = '全部' }: {label:string;value:string|string[];options:Option[];onChange:(value:string[])=>void;multiple?:boolean;placeholder?:string}) {
  const [search,setSearch] = useState(''), ref = useRef<HTMLDetailsElement>(null)
  const selected = Array.isArray(value) ? value : value ? [value] : []
  const chosen = selected.map(v => options.find(o => o.value===v)?.label || v).join('、')
  useEffect(() => {
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open=false }
    document.addEventListener('pointerdown',close); return () => document.removeEventListener('pointerdown',close)
  },[])
  return <details ref={ref} className={styles.select} onKeyDown={e => { if(e.key==='Escape' && ref.current) { ref.current.open=false; ref.current.querySelector('summary')?.focus(); e.stopPropagation() } }} onBlur={e => { if(!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open=false }}>
    <summary aria-label={label} title={chosen || placeholder}>{chosen || placeholder}<span aria-hidden="true">▾</span></summary>
    <div className={styles.selectMenu}>
      <input aria-label={`搜索${label}`} placeholder="搜索" value={search} onChange={e=>setSearch(e.target.value)} />
      <button type="button" onClick={()=> { onChange([]); if(!multiple && ref.current) ref.current.open=false }}>清空 / {placeholder}</button>
      <div className={styles.selectOptions}>
        {options.filter(o=>`${o.label} ${o.value}`.toLowerCase().includes(search.toLowerCase())).map(o => <button type="button" key={o.value} aria-pressed={selected.includes(o.value)} onClick={()=> { onChange(multiple ? selected.includes(o.value) ? selected.filter(v=>v!==o.value) : [...selected,o.value] : [o.value]); if(!multiple && ref.current) ref.current.open=false }}><span className={styles.optionCheck} aria-hidden="true">{selected.includes(o.value) ? '✓' : ''}</span>{o.label}</button>)}
        {!options.length && <p className={styles.empty}>暂无选项</p>}
      </div>
    </div>
  </details>
}
export function Field({label,full,children}: {label:string;full?:boolean;children:ReactNode}) { return <div className={`${styles.field} ${full ? styles.full : ''}`}><span>{label}</span>{children}</div> }
export function RangeInput({label,value,onChange,quick}: {label:string;value:Range;onChange:(value:Range)=>void;quick?:ReactNode}) {
  return <div className={`${styles.field} ${styles.full}`}><div className={styles.fieldRow}><span>{label}</span>{quick}</div><div className={styles.timeGroup}><input aria-label={`${label}开始`} type="datetime-local" step="1" value={value[0]} onChange={e=>onChange([e.target.value,value[1]])}/><span>至</span><input aria-label={`${label}结束`} type="datetime-local" step="1" value={value[1]} onChange={e=>onChange([value[0],e.target.value])}/></div></div>
}
export function Radio({label,value,onChange,options}: {label:string;value:string;onChange:(v:string)=>void;options:Option[]}) {
  const name=useId()
  return <div className={styles.radio} role="radiogroup" aria-label={label}>{options.map(o => <label key={o.value} className={value===o.value ? styles.on : ''}><input type="radio" name={name} value={o.value} checked={value===o.value} onChange={()=>onChange(o.value)}/>{o.label}</label>)}</div>
}
export function Drawer({title,onClose,children}: {title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null), titleId=useId()
  useEffect(()=> { const dialog=ref.current; dialog?.showModal(); return ()=>dialog?.close() },[])
  return <dialog ref={ref} className={styles.drawer} aria-labelledby={titleId} onCancel={onClose} onClick={e=> { if(e.target===e.currentTarget) { const box=e.currentTarget.getBoundingClientRect(); if(e.clientX<box.left || e.clientX>box.right) onClose() } }}><header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="关闭警情详情">关闭</button></header><div className={styles.drawerBody}>{children}</div></dialog>
}
export function Icon({kind}: {kind:'search'|'reset'|'download'}) {
  // Lucide paths, ISC license; inline to avoid adding an icon dependency.
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==='search' ? <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></> : kind==='reset' ? <><path d="M3 11a9 9 0 1 1 2.4 6.1M3 3v8h8"/></> : <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></>}</svg>
}
