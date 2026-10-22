"use client";
import { useEffect, useState } from 'react'
import { enrichStatusLabel, getTagV2AlarmDetail, groupTagsByDomain, personDisplayName, personExtractTags, personPriorTags, personRoleLabel, personTagLeaf, personZjTags, type TagV2AlarmRow, type TagV2ResultItem } from './api'
import { htmlToPlainText, sourceLabel } from './logic'
import { isRowSensitive, maskCjqkText, maskIdNo, maskPersonName, maskPhone } from './privacyMask'
import { errorText, Icon } from './ui'
import s from './tags.module.css'

export function alarmText(row: TagV2AlarmRow) {
  const text = htmlToPlainText(row.cjqk)
  return isRowSensitive(row) ? maskCjqkText(text, { personNames: (row.persons || []).map(person => person.personName) }) : text
}
export function evidenceText(row: TagV2AlarmRow, evidence?: string | null) {
  return isRowSensitive(row) ? maskCjqkText(evidence, { personNames: (row.persons || []).map(person => person.personName) }) : evidence || ''
}
export function tagClass(source?: string | null) { return `${s.chip} ${source === 'manual' ? s.manual : ['rule', 'map', 'third_party', 'zj-api'].includes(source || '') ? s.rule : ''}` }
export function TagSummary({ row, limit = 3 }: { row: TagV2AlarmRow; limit?: number }) {
  const tags = row.tags || []
  return <div className={s.row}>{tags.slice(0, limit).map((tag, i) => <span key={`${tag.tagPath}-${i}`} className={tagClass(tag.source)} title={`${tag.tagPath}\n来源：${sourceLabel(tag.source)}${tag.evidence ? '\n依据：' + evidenceText(row, tag.evidence) : ''}`}>{tag.name || tag.tagPath.split('/').pop()}</span>)}{tags.length > limit && <span className={s.muted}>+{tags.length - limit}</span>}{!tags.length && '-'}</div>
}
export function PersonSummary({ row }: { row: TagV2AlarmRow }) {
  return <div>{(row.persons || []).slice(0, 2).map((person, i) => { const tag = personZjTags(person)[0] || personExtractTags(person)[0]; const name = isRowSensitive(row) ? maskPersonName(personDisplayName(person)) : personDisplayName(person); return <div className={s.ellipsis} key={i}>{name}（{person.personRoleLabel || personRoleLabel(person.personRole)}）·{tag ? personTagLeaf(tag) : enrichStatusLabel(person.enrichStatus)}</div> })}{(row.persons || []).length > 2 && <span className={s.muted}>+{row.persons!.length - 2} 人</span>}{!row.persons?.length && '-'}</div>
}
export function Persons({ row, onTagClick }: { row: TagV2AlarmRow; onTagClick?: (path: string) => void }) {
  const masked = isRowSensitive(row)
  return <div className={s.stack}>{!row.persons?.length && <div className={s.empty}>暂无涉警人员</div>}{(row.persons || []).map((person, index) => <div className={s.person} key={`${person.personRole}-${index}`}><div className={s.row}><span className={`${s.chip} ${s.neutral}`}>{person.personRoleLabel || personRoleLabel(person.personRole)}</span><strong>{masked ? maskPersonName(personDisplayName(person)) : personDisplayName(person)}</strong>{person.idNo && <span className={s.muted}>{masked ? maskIdNo(person.idNo) : person.idNo}</span>}{person.phone && <span className={s.muted}>{masked ? maskPhone(person.phone) : person.phone}</span>}<span className={s.muted}>{enrichStatusLabel(person.enrichStatus)}</span></div>{[
    { label: '', tags: personExtractTags(person), className: '', empty: '' },
    { label: '治安标签', tags: personZjTags(person), className: s.warning, empty: person.enrichStatus === '2' ? '无命中' : person.enrichStatus === '1' ? '已补全(无明细)' : '待补全' },
    { label: '前科标签', tags: personPriorTags(person), className: s.prior, empty: '无命中' },
  ].map((group, i) => <div className={s.row} style={{ marginTop: 8 }} key={i}>{group.label && <span className={s.muted}>{group.label}</span>}{group.tags.map((tag, j) => onTagClick ? <button key={j} className={`${tagClass(tag.source)} ${group.className}`} title={tag.tagPath} onClick={() => onTagClick(tag.tagPath)}>{personTagLeaf(tag)}</button> : <span key={j} className={`${tagClass(tag.source)} ${group.className}`} title={tag.tagPath}>{personTagLeaf(tag)}</span>)}{!group.tags.length && <span className={s.muted}>{group.empty}</span>}</div>)}{personExtractTags(person).filter(tag => tag.evidence).map((tag, i) => <p key={i}>{personTagLeaf(tag)}：{evidenceText(row, tag.evidence)}</p>)}</div>)}</div>
}
function TagPath({ tag, domain, row, onTagClick }: { tag: TagV2ResultItem; domain: string; row: TagV2AlarmRow; onTagClick?: (path: string) => void }) {
  const parts = tag.tagPath.split('/').filter(Boolean)
  const start = parts.length > 1 && parts[0] === domain ? 1 : 0
  const title = `${tag.tagPath}\n${sourceLabel(tag.source)}${tag.confidence != null ? ' ' + Number(tag.confidence).toFixed(2) : ''}${tag.evidence ? '\n依据：' + evidenceText(row, tag.evidence) : ''}`
  return <div className={s.tagLine}>{parts.slice(start).map((part, index) => { const leaf = index === parts.length - start - 1; const path = parts.slice(0, start + index + 1).join('/'); return <span className={s.row} style={{ gap: 4 }} key={path}>{index > 0 && <span className={s.muted}>/</span>}{onTagClick ? <button className={leaf ? tagClass(tag.source) : `${s.chip} ${s.neutral}`} title={leaf ? title : path} onClick={() => onTagClick(path)}>{part}{leaf && tag.confidence != null && <small>{Number(tag.confidence).toFixed(2)}</small>}</button> : <span className={leaf ? tagClass(tag.source) : `${s.chip} ${s.neutral}`} title={leaf ? title : path}>{part}</span>}</span> })}{!onTagClick && <><span className={s.muted}>{sourceLabel(tag.source)} {tag.confidence != null ? Number(tag.confidence).toFixed(2) : ''}</span>{tag.evidence && <div className={s.muted} style={{ width: '100%' }}>依据：{evidenceText(row, tag.evidence)}</div>}</>}</div>
}
export function AlarmDetailContent({ row, onTagClick, onRefresh, modal = false }: { row: TagV2AlarmRow; onTagClick?: (path: string) => void; onRefresh?: () => void; modal?: boolean }) {
  const fields = modal ? [['反馈单号', row.fkdbh], ['处警单号', row.cjdbh], ['报警时间', row.bjsj], ['责任人', row.zrmj], ['反馈单位', row.fkdwmc], ['反馈人', row.fkrxm]] : [['反馈单号', row.fkdbh], ['接警单号', row.jjdbh], ['报警时间', row.bjsj], ['反馈单位', row.fkdwmc], ['责任人', row.zrmj], ['警情区划', row.jqqh]]
  return <div className={s.stack}><section className={s.fields}>{fields.map(([label, value]) => <div key={label}><p className={s.muted}>{label}</p><p title={value || ''}>{value || '-'}</p></div>)}</section><section><h3 className={s.subhead}>处警情况</h3><div className={s.content}>{alarmText(row) || '暂无处警情况'}</div></section><section className={s.stack}><div className={s.row}><h3 className={s.subhead}>警情打标结果</h3><span className={`${s.muted} ${s.end}`}>{row.tagCount || row.tags?.length || 0} 个标签</span>{onRefresh && <button className={s.link} title="刷新" aria-label="刷新详情" onClick={onRefresh}><Icon name="reset" /></button>}</div>{groupTagsByDomain(row.tags).map(group => <div className={s.tagGroup} key={group.domain}><div className={s.groupHead}>{onTagClick && group.domain !== '未分类' ? <button className={s.link} onClick={() => onTagClick(group.domain)} title={`按「${group.domain}」下全部标签检索`}>{group.domain}</button> : group.domain} <span className={s.muted}>({group.items.length})</span></div>{group.items.map((tag, index) => <TagPath key={index} tag={tag} domain={group.domain} row={row} onTagClick={onTagClick} />)}</div>)}{!row.tags?.length && <div className={s.empty}>暂无标签</div>}</section><section className={s.stack}><div className={s.row}><h3 className={s.subhead}>涉警人员</h3><span className={`${s.muted} ${s.end}`}>{row.personCount || row.persons?.length || 0} 人</span></div><Persons row={row} onTagClick={onTagClick} /></section></div>
}
export function AlarmDetail({ fkdbh, onTagClick }: { fkdbh: string | null; onTagClick: (path: string) => void }) {
  const [row, setRow] = useState<TagV2AlarmRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let disposed = false
    setRow(null); setError('')
    if (!fkdbh) { setBusy(false); return }
    setBusy(true)
    getTagV2AlarmDetail(fkdbh).then(result => { if (!disposed) setRow(result.data || null) }).catch(error => { if (!disposed) setError(errorText(error, '警情详情加载失败')) }).finally(() => { if (!disposed) setBusy(false) })
    return () => { disposed = true }
  }, [fkdbh, revision])
  return <div className={`${s.scroll} ${s.body}`} aria-busy={busy}>{error && <div className={`${s.status} ${s.error}`} role="alert">{error}<button className={s.link} onClick={() => setRevision(n => n + 1)}>重试</button></div>}{busy ? <div className={s.empty} role="status">详情加载中…</div> : row ? <AlarmDetailContent row={row} onTagClick={onTagClick} onRefresh={() => setRevision(n => n + 1)} /> : !error && <div className={s.empty}>{fkdbh ? '暂无数据' : '点击左侧列表中的警情查看详情'}</div>}</div>
}
