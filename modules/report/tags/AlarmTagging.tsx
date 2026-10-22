"use client";
import { Fragment, useEffect, useRef, useState } from 'react'
import { getTagV2AlarmDetail, listTagV2Catalog, searchTagV2Alarms, verifyTagV2Alarm, type TagV2AlarmRow, type TagV2DictItem, type TagV2SearchPayload, type TagV2SearchResult } from './api'
import { AlarmDetailContent, alarmText, Persons, PersonSummary, TagSummary } from './AlarmDetail'
import { dataDayRange, levelOptions, rangesOverlap, rowKey, splitAlarmContentBlocks } from './logic'
import { persistDateRangeShortcut, readReportDateRange, syncTimeToReportCache } from './reportDateRange'
import { departmentFilter, loadScope, type Scope } from './scope'
import { DateRange, DepartmentSelect, errorText, Icon, Modal, MultiSelect, Pagination, Select } from './ui'
import s from './tags.module.css'

interface Filters { cjdbh: string; keyword: string; begin: string; end: string; dept: string; tags: string[]; level1: string; level2: string; level3: string; verifyStatus: 'all' | 'manual' | 'auto' }
const emptyFilters: Filters = { cjdbh: '', keyword: '', begin: '', end: '', dept: '', tags: [], level1: '', level2: '', level3: '', verifyStatus: 'all' }
export default function AlarmTagging() {
  const [scope, setScope] = useState<Scope | null>(null)
  const [catalog, setCatalog] = useState<TagV2DictItem[]>([])
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [result, setResult] = useState<TagV2SearchResult>({ rows: [], total: 0 })
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [busy, setBusy] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [searched, setSearched] = useState(false)
  const [detailId, setDetailId] = useState('')
  const [verifyingId, setVerifyingId] = useState('')
  const [draftPaths, setDraftPaths] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [quickId, setQuickId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestId = useRef(0)
  const mutationBusy = useRef(false)
  function payload(f: Filters, account: Scope, p: number): TagV2SearchPayload {
    return { tags: [...f.tags, f.level1, f.level2, f.level3].filter(Boolean), ...departmentFilter(account, f.dept, true), cjdbh: f.cjdbh.trim() || undefined, keyword: f.keyword.trim() || undefined, beginTime: f.begin.trim() || undefined, endTime: f.end.trim() || undefined, hasManual: f.verifyStatus === 'manual' ? true : f.verifyStatus === 'auto' ? false : undefined, pageNum: p, pageSize }
  }
  async function search(f = filters, p = 1, account = scope) {
    if (!account) { setError('部门范围尚未加载，无法查询。请刷新重试。'); return }
    const query = payload(f, account, p)
    if (!((f.begin && f.end) || query.cjdbh || query.fkdwdm || query.fkdwmc || query.keyword || query.tags?.length)) { setError('请先选择时间范围或其它筛选条件，再查询'); return }
    if (f.begin && f.end && f.begin >= f.end) { setError('报警时间止必须晚于报警时间起'); return }
    const id = ++requestId.current
    setBusy(true); setError(''); setPage(p); setVerifyingId(''); setDraftPaths([])
    try {
      const response = await searchTagV2Alarms(query)
      if (id !== requestId.current) return
      setResult(response.data || { rows: [], total: 0 }); setSearched(true)
      if (response.data.total > 0) setExpanded(false)
      if (!response.data.rows.some(row => rowKey(row) === detailId)) setDetailId('')
    } catch (error) { if (id === requestId.current) setError(errorText(error, '警情列表加载失败')) } finally { if (id === requestId.current) setBusy(false) }
  }
  useEffect(() => {
    let disposed = false
    async function init() {
      const results = await Promise.allSettled([loadScope(), listTagV2Catalog()] as const)
      if (disposed) return
      const [account, dict] = results
      const cached = readReportDateRange()
      const f: Filters = { ...emptyFilters, begin: cached.beginTime, end: cached.endTime }
      if (dict.status === 'fulfilled') {
        setCatalog(dict.value.data.tags || [])
        const range = dict.value.data.dataRange
        const cover = dataDayRange(range?.beginTime, range?.endTime)
        if (cover) {
          if (!f.begin || !f.end) { const day = dataDayRange(range?.beginTime, range?.endTime, true); if (day) [f.begin, f.end] = day }
          else if (!rangesOverlap(f.begin, f.end, range?.beginTime, range?.endTime)) { [f.begin, f.end] = cover; setNotice('当前报告时间范围内无打标数据，已切换到有数据区间') }
        }
      }
      if (account.status === 'fulfilled') { setScope(account.value); f.dept = account.value.defaultKey }
      setFilters(f)
      if (account.status === 'fulfilled' && f.begin && f.end) await search(f, 1, account.value)
      if (disposed) return
      const failures = results.filter(result => result.status === 'rejected').map(result => errorText((result as PromiseRejectedResult).reason, '初始化失败'))
      if (failures.length) setError(failures.join('；'))
      setInitializing(false)
    }
    void init()
    return () => { disposed = true; /* invalidate late search responses on unmount */
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestId.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function reset() {
    const cache = readReportDateRange()
    const f = { ...emptyFilters, dept: scope?.defaultKey || '', begin: cache.beginTime || filters.begin, end: cache.endTime || filters.end }
    setFilters(f); void search(f)
  }
  function startVerify(row: TagV2AlarmRow) {
    if (saving || quickId) return
    const key = rowKey(row)
    setVerifyingId(key === verifyingId ? '' : key)
    setDraftPaths(key === verifyingId ? [] : (row.tags || []).map(tag => tag.tagPath))
  }
  async function verify(row: TagV2AlarmRow, quick = false) {
    if (mutationBusy.current) return
    mutationBusy.current = true
    const key = rowKey(row)
    if (quick) setQuickId(key); else setSaving(true)
    setError('')
    try {
      const response = await verifyTagV2Alarm({ fkdbh: key, tagPaths: quick ? (row.tags || []).map(tag => tag.tagPath) : draftPaths })
      const saved = response.data || (await getTagV2AlarmDetail(key)).data
      if (!saved) throw new Error('核对已提交，但未取得更新详情，请重新查询确认')
      setResult(current => ({ ...current, rows: current.rows.map(item => rowKey(item) === key ? { ...item, ...saved } : item) }))
      if (!quick || verifyingId === key) { setVerifyingId(''); setDraftPaths([]) }
      setNotice(quick ? '已核对' : '核对保存成功')
    } catch (error) { setError(errorText(error, '核对保存失败')) } finally { setQuickId(''); setSaving(false); mutationBusy.current = false }
  }
  const options = catalog.map(tag => ({ value: tag.tagPath, label: tag.tagPath })).sort((a, b) => a.value.length - b.value.length)
  const detail = result.rows.find(row => rowKey(row) === detailId)
  const disabled = busy || initializing || saving || Boolean(quickId)
  return <section className={s.page}>
    <section className={`${s.card} ${s.taggingCard}`} style={{ flexShrink: 0 }}><div className={s.filters}><div className={s.row}><Icon name="tags" /><h1 className={s.title}>警情打标</h1></div><div className={`${s.row} ${s.end}`}><MultiSelect label="包含标签路径（可搜上级分类）" width={300} options={options} value={filters.tags} onChange={tags => setFilters(f => ({ ...f, tags }))} /><DateRange begin={filters.begin} end={filters.end} onChange={(begin, end) => { setFilters(f => ({ ...f, begin, end })); persistDateRangeShortcut(''); syncTimeToReportCache(begin, end) }} /><Select label="按一级标签筛选" value={filters.level1} options={levelOptions(catalog, 1)} onChange={level1 => setFilters(f => ({ ...f, level1, level2: '', level3: '' }))} /><Select label="按二级标签筛选" value={filters.level2} options={levelOptions(catalog, 2, filters.level1)} onChange={level2 => setFilters(f => ({ ...f, level2, level3: '' }))} /><Select label="按三级标签筛选" value={filters.level3} options={levelOptions(catalog, 3, filters.level2 || filters.level1)} onChange={level3 => setFilters(f => ({ ...f, level3 }))} /><DepartmentSelect scope={scope} value={filters.dept} onChange={dept => setFilters(f => ({ ...f, dept }))} /><button className={`${s.button} ${s.primary}`} disabled={disabled || !scope} onClick={() => void search()}><Icon name="search" />{busy ? '查询中…' : '查询'}</button><button className={s.button} aria-expanded={expanded} aria-controls="tagging-extra-filters" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开'}</button></div></div>{expanded && <div className={s.extraFilters} id="tagging-extra-filters"><input className={s.control} aria-label="处警单号" placeholder="处警单号" value={filters.cjdbh} onChange={event => setFilters(f => ({ ...f, cjdbh: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !disabled) void search() }} /><input className={s.control} aria-label="处警情况关键词" placeholder="处警情况关键词" value={filters.keyword} onChange={event => setFilters(f => ({ ...f, keyword: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !disabled) void search() }} /><select className={s.control} aria-label="标签来源" value={filters.verifyStatus} onChange={event => setFilters(f => ({ ...f, verifyStatus: event.target.value as Filters['verifyStatus'] }))}><option value="all">全部</option><option value="manual">含人工标签</option><option value="auto">仅自动标签</option></select><div className={s.row}><button className={`${s.button} ${s.primary}`} disabled={disabled || !scope} onClick={() => void search()}><Icon name="search" />查询</button><button className={s.button} disabled={disabled || !scope} onClick={reset}><Icon name="reset" />重置</button></div></div>}</section>
    {error && <div className={`${s.status} ${s.error}`} role="alert">{error}<button className={s.link} aria-label="关闭错误" onClick={() => setError('')}><Icon name="close" /></button></div>}{notice && <div className={s.status} role="status">{notice}<button className={s.link} aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" /></button></div>}
    <section className={`${s.card} ${s.taggingCard} ${s.grow}`} aria-busy={busy}><header className={s.header}><Pagination page={page} size={pageSize} total={result.total} exact={result.exactTotal !== false} hasMore={result.hasMore} busy={disabled} onPage={p => void search(filters, p)} /></header><div className={s.tableWrap}>{(busy || initializing) && <div className={s.status} role="status">加载中…</div>}<table className={s.table}><thead><tr>{['', '#', '反馈单号', '反馈单位', '是否核对', '报警时间', '责任人', '反馈人', '处警情况', '警情标签', '涉警人员', '操作'].map((title, i) => <th key={i} scope="col">{title}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => { const key = rowKey(row); const content = alarmText(row); const blocks = splitAlarmContentBlocks(content); return <Fragment key={key}><tr onDoubleClick={() => setDetailId(key)}><td><button className={s.link} aria-label={`${verifyingId === key ? '收起' : '展开'}核对 ${key}`} aria-expanded={verifyingId === key} disabled={saving || Boolean(quickId)} onClick={() => startVerify(row)}>{verifyingId === key ? '−' : '+'}</button></td><td>{(page - 1) * pageSize + index + 1}</td><td><button className={s.link} style={{ fontFamily: 'var(--font-mono)', minWidth: 190 }} onClick={() => setDetailId(key)}>{row.fkdbh || '-'}</button></td><td>{row.fkdwmc || '-'}</td><td><span className={`${s.chip} ${row.manualVerified ? s.manual : s.neutral}`}>{row.manualVerified ? '已核对' : '未核对'}</span></td><td>{row.bjsj || '-'}</td><td>{row.zrmj || '-'}</td><td>{row.fkrxm || '-'}</td><td><span className={s.ellipsis} style={{ width: 380, maxWidth: 380 }} title={content}>{content || '-'}</span></td><td className={s.wrapCell} style={{ minWidth: 300 }}><TagSummary row={row} /></td><td><PersonSummary row={row} /></td><td><div className={s.row} style={{ flexWrap: 'nowrap' }}><button className={s.link} onClick={() => setDetailId(key)}>详情</button><button className={s.link} disabled={saving || Boolean(quickId)} onClick={() => startVerify(row)}>{verifyingId === key ? '收起' : '核对'}</button><button className={`${s.link} ${s.manual}`} disabled={saving || Boolean(quickId) || busy} onClick={() => void verify(row, true)} title="按现有标签路径直接核对">{quickId === key ? '保存中…' : 'OK'}</button></div></td></tr>{verifyingId === key && <tr><td colSpan={12}><div className={s.verify}><section className={s.stack}><h3 className={s.subhead}>警情内容及处置情况</h3><div className={`${s.content} ${s.scroll}`}>{blocks.blocks.length ? blocks.blocks.map((block, i) => <p className={i === blocks.highlightIndex ? s.highlight : undefined} key={i}>{block}</p>) : '暂无警情内容'}</div></section><section className={s.stack}><div><h3 className={s.subhead}>编辑警情标签</h3><MultiSelect label="从 tag_dict_v2 选择标签路径" width={420} options={options} value={draftPaths} onChange={setDraftPaths} allowCreate /><div className={s.selectedPaths}>{draftPaths.slice(0, 6).map(path => <button className={s.chip} key={path} title={path} disabled={saving} onClick={() => setDraftPaths(current => current.filter(item => item !== path))}>{path.split('/').pop()}<Icon name="close" /></button>)}{draftPaths.length > 6 && <span className={s.muted}>+{draftPaths.length - 6}</span>}</div></div><h3 className={s.subhead}>涉警人员</h3><div className={s.scroll}><Persons row={row} /></div><div className={s.row}><button className={s.button} disabled={saving} onClick={() => { setVerifyingId(''); setDraftPaths([]) }}>取消</button><button className={`${s.button} ${s.primary}`} disabled={saving || Boolean(quickId)} onClick={() => void verify(row)}>{saving ? '保存中…' : '保存核对'}</button></div></section></div></td></tr>}</Fragment> })}</tbody></table>{!busy && !initializing && !result.rows.length && <div className={s.empty}>{searched ? '未检索到已打标警情' : '请设置筛选条件后查询'}</div>}</div></section>
    {detail && <Modal title={detail.fkdbh || '警情详情'} onClose={() => setDetailId('')}><AlarmDetailContent row={detail} modal /></Modal>}
  </section>
}
