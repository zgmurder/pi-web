"use client";
import { useEffect, useRef, useState } from 'react'
import { deleteTagV2Package, exportTagV2Alarms, listTagV2Catalog, listTagV2Packages, searchTagV2Alarms, type TagV2AlarmRow, type TagV2DictItem, type TagV2Package, type TagV2SearchPayload, type TagV2SearchResult } from './api'
import { AlarmDetail, alarmText, PersonSummary, TagSummary } from './AlarmDetail'
import { conditionLogic, relationLabel, rowKey, tagValue } from './logic'
import { PackageEditor } from './PackageEditor'
import { persistDateRangeShortcut, syncTimeToReportCache } from './reportDateRange'
import { departmentFilter, feedbackOptions, loadFeedback, loadScope, type FeedbackNode, type Scope } from './scope'
import { DateRange, DepartmentSelect, errorText, Icon, Modal, MultiSelect, Pagination } from './ui'
import s from './tags.module.css'

interface Filters { begin: string; end: string; dept: string; ajlb: string[]; ajlx: string[]; ajxl: string[] }
const emptyFilters: Filters = { begin: '', end: '', dept: '', ajlb: [], ajlx: [], ajxl: [] }
const emptyResult: TagV2SearchResult = { rows: [], total: 0, exactTotal: true }
export default function TagWorkbench() {
  const [scope, setScope] = useState<Scope | null>(null)
  const [catalog, setCatalog] = useState<TagV2DictItem[]>([])
  const [feedback, setFeedback] = useState<FeedbackNode[]>([])
  const [packages, setPackages] = useState<TagV2Package[]>([])
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<TagV2Package | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [detailTag, setDetailTag] = useState('')
  const [result, setResult] = useState<TagV2SearchResult>(emptyResult)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [packageBusy, setPackageBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editor, setEditor] = useState<{ item: TagV2Package | null } | null>(null)
  const [deleting, setDeleting] = useState<TagV2Package | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [detailWidth, setDetailWidth] = useState(420)
  const sequence = useRef(0)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)

  function payload(f = filters, selectedPackage = selected, path = detailTag, p = page, count = size, account = scope): TagV2SearchPayload {
    return { tags: path ? [path] : (selectedPackage?.tags || []).map(tagValue).filter(Boolean), logic: path ? 'and' : selectedPackage?.condition ? conditionLogic(selectedPackage.condition) : selectedPackage?.logic || 'and', beginTime: f.begin.trim() || undefined, endTime: f.end.trim() || undefined, ...(account ? departmentFilter(account, f.dept) : {}), ajlbCodes: f.ajlb, ajlxCodes: f.ajlx, ajxlCodes: f.ajxl, pageNum: p, pageSize: count }
  }
  async function search(options: { filters?: Filters; selected?: TagV2Package | null; tag?: string; page?: number; size?: number; scope?: Scope } = {}, notify = false) {
    const account = options.scope || scope
    if (!account) { setError('部门范围尚未加载，无法检索。请刷新重试。'); return }
    const f = options.filters || filters
    if (f.begin && f.end && f.begin >= f.end) { setError('报警时间止必须晚于报警时间起'); return }
    const p = options.page || 1, count = options.size || size
    const id = ++sequence.current
    setBusy(true); setError(''); setPage(p); setSize(count)
    try {
      const response = await searchTagV2Alarms(payload(f, options.selected === undefined ? selected : options.selected, options.tag === undefined ? detailTag : options.tag, p, count, account))
      if (sequence.current !== id) return
      const data = response.data || emptyResult
      setResult(data); setSelectedRow(data.rows.length ? rowKey(data.rows[0]) : null); setChecked([]); setSearched(true)
      if (notify) setNotice(data.exactTotal !== false ? `已筛选出 ${data.total} 条命中警情` : `已加载第 ${p} 页`)
    } catch (error) { if (sequence.current === id) setError(errorText(error, '标签检索失败')) } finally { if (sequence.current === id) setBusy(false) }
  }
  useEffect(() => {
    let disposed = false
    try { const saved = Number.parseInt(localStorage.getItem('report_tag_detail_width') || '', 10); if (Number.isFinite(saved)) setDetailWidth(clampWidth(saved)) } catch { /* storage optional */ }
    async function init() {
      const results = await Promise.allSettled([loadScope(), listTagV2Catalog(), listTagV2Packages(), loadFeedback()] as const)
      if (disposed) return
      const [account, dict, pkgs, tree] = results
      if (dict.status === 'fulfilled') setCatalog(dict.value.data.tags || [])
      if (pkgs.status === 'fulfilled') setPackages(pkgs.value.data || [])
      if (tree.status === 'fulfilled') setFeedback(tree.value)
      if (account.status === 'fulfilled') {
        setScope(account.value)
        const f = { ...emptyFilters, dept: account.value.defaultKey }
        setFilters(f)
        await search({ scope: account.value, filters: f })
      }
      if (disposed) return
      const failures = results.filter(r => r.status === 'rejected').map(r => errorText((r as PromiseRejectedResult).reason, '初始化失败'))
      if (failures.length) setError(failures.join('；'))
      setInitializing(false)
    }
    void init()
    return () => { disposed = true; /* invalidate late search responses on unmount */
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++
    }
    // Initial requests intentionally run once; subsequent actions pass their current filter snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function choose(item: TagV2Package) { setSelected(item); setDetailTag(''); setChecked([]); void search({ selected: item, tag: '' }) }
  async function reloadPackages(id?: string) {
    setPackageBusy(true)
    try {
      const response = await listTagV2Packages()
      setPackages(response.data || [])
      if (id) { const item = response.data.find(pkg => String(pkg.id) === String(id)); if (item) choose(item) }
    } finally { setPackageBusy(false) }
  }
  function reset() {
    const f = { ...emptyFilters, dept: scope?.defaultKey || '' }
    setFilters(f); setSelected(null); setDetailTag(''); void search({ filters: f, selected: null, tag: '' })
  }
  async function exportRows(kind: 'all-alarms' | 'all-people' | 'selected-alarms') {
    if (!scope || exporting) return
    if (!searched) { setError('请先检索后再导出'); return }
    if (kind === 'selected-alarms' && !checked.length) { setError('请先勾选要导出的警情'); return }
    setExporting(true); setError('')
    try {
      const query = payload()
      delete query.pageNum
      delete query.pageSize
      await exportTagV2Alarms({ ...query, selectedIds: kind === 'selected-alarms' ? checked : undefined, exportType: kind === 'all-people' ? 'people' : 'alarms' }, `研判包${kind === 'all-people' ? '涉及人员' : '命中警情'}${kind === 'selected-alarms' ? '-选中' : ''}.xlsx`)
      setNotice('导出文件已生成')
    } catch (error) { setError(errorText(error, '导出失败')) } finally { setExporting(false) }
  }
  async function deletePackage() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true); setError('')
    try {
      await deleteTagV2Package(deleting.id)
      if (selected?.id === deleting.id) { setSelected(null); setDetailTag(''); await search({ selected: null, tag: '' }) }
      await reloadPackages(); setDeleting(null); setNotice('标签组合已删除')
    } catch (error) { setError(errorText(error, '标签组合删除失败')) } finally { setDeleteBusy(false) }
  }
  function changeDetailTag(path: string) { if (path === detailTag) return; setDetailTag(path); void search({ tag: path }) }
  function clampWidth(value: number) { return Math.min(Math.max(420, Math.min(760, Math.floor(window.innerWidth * .6))), Math.max(300, Math.round(value))) }
  function persistWidth(value: number) { try { localStorage.setItem('report_tag_detail_width', String(value)) } catch { /* storage optional */ } }
  const filteredPackages = packages.filter(item => `${item.name} ${item.remark}`.includes(keyword.trim()))
  const exact = result.exactTotal !== false
  return <section className={`${s.page} ${s.workbench}`}>
    <aside className={`${s.card} ${s.packages}`} aria-label="标签组合"><header className={s.header}><h1 className={s.title}>标签组合 <span className={s.muted}>（{filteredPackages.length}）</span></h1><button className={`${s.button} ${s.primary}`} disabled={initializing || packageBusy} onClick={() => setEditor({ item: null })}><Icon name="plus" />新增组合</button></header><div className={s.body}><input className={`${s.control} ${s.full}`} aria-label="搜索组合" placeholder="搜索组合" value={keyword} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void reloadPackages().catch(error => setError(errorText(error, '研判包加载失败'))) }} /></div><div className={s.scroll}>{filteredPackages.map(item => <article className={`${s.package} ${selected?.id === item.id ? s.selected : ''}`} key={item.id}><div className={s.row}><button className={`${s.link} ${s.grow}`} style={{ color: 'inherit', fontWeight: 600 }} onClick={() => choose(item)} aria-pressed={selected?.id === item.id}>{item.name}</button><div className={`${s.row} ${s.actions}`}><button className={s.link} title="修改组合" aria-label={`修改组合 ${item.name}`} onClick={() => setEditor({ item })}><Icon name="edit" /></button><button className={`${s.link} ${s.danger}`} title="删除组合" aria-label={`删除组合 ${item.name}`} onClick={() => setDeleting(item)}><Icon name="trash" /></button></div></div><div className={s.row} style={{ gap: 4, marginTop: 6 }}><span className={`${s.chip} ${item.condition?.match === 'any' || item.logic === 'or' ? s.warning : s.manual}`}>{relationLabel(item)}</span>{item.tags.slice(0, 3).map((tag, index) => <span key={index} className={s.chip} title={tagValue(tag)}>{tag.name}</span>)}{item.tags.length > 3 && <span className={s.muted}>+{item.tags.length - 3}</span>}</div><div className={`${s.row} ${s.muted}`} style={{ marginTop: 6 }}><span className={s.ellipsis} style={{ flex: 1 }}>{item.remark || '暂无备注'}</span><span>{item.createdAt}</span></div></article>)}{!filteredPackages.length && <div className={s.empty}>{initializing ? '组合加载中…' : '暂无标签组合'}</div>}</div></aside>
    <main className={s.main}>
      <section className={s.card}><div className={s.filters}><div className={s.row}><Icon name="tags" /><div><h2 className={s.title}>标签组合检索</h2><div className={s.muted}>{detailTag ? `当前：按详情标签「${detailTag.split('/').pop()}」检索` : selected ? `当前：${selected.name} · ${selected.tags.length} 个标签` : '先在左侧选择或新建标签组合'}</div></div></div><div className={`${s.row} ${s.end}`}><DateRange begin={filters.begin} end={filters.end} onChange={(begin, end) => { setFilters(f => ({ ...f, begin, end })); persistDateRangeShortcut(''); syncTimeToReportCache(begin, end) }} /><DepartmentSelect scope={scope} value={filters.dept} onChange={dept => setFilters(f => ({ ...f, dept }))} />{(['category', 'type', 'subtype'] as const).map((level, i) => { const key = (['ajlb', 'ajlx', 'ajxl'] as const)[i]; return <MultiSelect key={key} label={['反馈类别', '反馈类型', '反馈细类'][i]} width={120} options={feedbackOptions(feedback, level)} value={filters[key]} onChange={values => setFilters(f => ({ ...f, [key]: values }))} /> })}<button className={`${s.button} ${s.primary}`} disabled={busy || initializing || !scope} onClick={() => void search({}, true)}><Icon name="search" />{busy ? '检索中…' : '检索'}</button><button className={s.button} disabled={busy || !scope} onClick={reset}><Icon name="reset" />重置</button><button className={s.button} disabled title="原 Report 专项报告编辑器尚未接入 Pi Web；不会创建无法编辑的报告">生成专项报告（待接入）</button><select className={s.control} aria-label="导出" value="" disabled={exporting || !scope || busy} onChange={event => { if (event.target.value) void exportRows(event.target.value as 'all-alarms' | 'all-people' | 'selected-alarms') }}><option value="">{exporting ? '导出中…' : '导出'}</option><option value="all-alarms">导出全部命中警情</option><option value="all-people">导出全部涉及人员</option><option value="selected-alarms">导出选中警情</option></select></div></div>
        {detailTag && <div className={`${s.header} ${s.warning}`}><span>详情标签检索：<button className={s.chip} onClick={() => changeDetailTag('')}>{detailTag.split('/').pop()} <Icon name="close" /></button> <span className={s.muted}>关闭后恢复组合检索条件</span></span></div>}
        {selected && <div className={s.header} style={{ justifyContent: 'flex-start' }}><span className={s.muted}>组合标签：</span><span className={s.chip}>{relationLabel(selected)}</span>{selected.tags.map((tag, index) => <span key={index} className={s.chip} title={tagValue(tag)}>{tag.name}</span>)}<button className={s.link} onClick={() => setEditor({ item: selected })}>修改组合</button></div>}
      </section>
      {error && <div className={`${s.status} ${s.error}`} role="alert">{error}<button className={`${s.link} ${s.end}`} onClick={() => setError('')} aria-label="关闭错误"><Icon name="close" /></button></div>}{notice && <div className={s.status} role="status">{notice}<button className={s.link} onClick={() => setNotice('')} aria-label="关闭提示"><Icon name="close" /></button></div>}
      <section className={`${s.card} ${s.grow}`} aria-busy={busy}><header className={s.header}><Pagination page={page} size={size} total={result.total} exact={exact} hasMore={result.hasMore} busy={busy} onPage={p => void search({ page: p })} onSize={count => void search({ size: count })} /><div className={s.stats}><span>命中 <b>{searched && exact ? result.total.toLocaleString() : '--'}</b></span><span>人员 <b>{searched && exact ? Number(result.peopleTotal || 0).toLocaleString() : '--'}</b></span><span>单位 <b>{searched && exact ? Number(result.stationTotal || 0).toLocaleString() : '--'}</b></span></div></header><div className={s.tableWrap}>{busy && <div className={s.status} role="status">检索中…</div>}<table className={s.table}><thead><tr>{['选择', '反馈单号', '报警时间', '反馈单位', '责任人', '警情标签', '涉警人员', '处警情况'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{result.rows.map((row: TagV2AlarmRow) => { const key = rowKey(row); const text = alarmText(row); return <tr key={key} className={selectedRow === key ? s.selected : ''} onClick={() => setSelectedRow(key)}><td><input type="checkbox" aria-label={`选择警情 ${key}`} checked={checked.includes(key)} onClick={event => event.stopPropagation()} onChange={event => setChecked(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))} /></td><td><button className={s.link} style={{ fontFamily: 'var(--font-mono)' }} onClick={() => setSelectedRow(key)}>{row.fkdbh || '-'}</button></td><td>{row.bjsj || '-'}</td><td>{row.fkdwmc || '-'}</td><td>{row.zrmj || '-'}</td><td className={s.wrapCell}><TagSummary row={row} /></td><td><PersonSummary row={row} /></td><td><span className={s.ellipsis} title={text}>{text || '-'}</span></td></tr> })}</tbody></table>{!busy && !result.rows.length && <div className={s.empty}>{initializing ? '加载中…' : '未检索到命中警情'}</div>}</div></section>
    </main>
    <div className={s.resizer} role="separator" aria-label="调整详情面板宽度" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={760} aria-valuenow={detailWidth} tabIndex={0} title="拖动调整详情面板宽度，双击恢复默认" onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); resizeStart.current = { x: event.clientX, width: detailWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (resizeStart.current) setDetailWidth(clampWidth(resizeStart.current.width + resizeStart.current.x - event.clientX)) }} onPointerUp={() => { resizeStart.current = null; persistWidth(detailWidth) }} onPointerCancel={() => { resizeStart.current = null; persistWidth(detailWidth) }} onDoubleClick={() => { setDetailWidth(420); persistWidth(420) }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const width = clampWidth(detailWidth + (event.key === 'ArrowLeft' ? 20 : -20)); setDetailWidth(width); persistWidth(width) } }} />
    <aside className={`${s.card} ${s.detail}`} style={{ width: detailWidth }}><header className={s.header}><h2 className={s.title}>警情详情</h2><span className={`${s.muted} ${s.ellipsis}`}>{selectedRow || '未选中'}</span></header><AlarmDetail fkdbh={selectedRow} onTagClick={changeDetailTag} /></aside>
    {editor && <PackageEditor item={editor.item} catalog={catalog} feedback={feedback} onClose={() => setEditor(null)} onSaved={async id => { await reloadPackages(id); setEditor(null); setNotice('标签组合已保存') }} />}
    {deleting && <Modal title="删除标签组合" onClose={() => { if (!deleteBusy) setDeleting(null) }} footer={<div className={`${s.row} ${s.end}`}><button className={s.button} disabled={deleteBusy} onClick={() => setDeleting(null)}>取消</button><button className={`${s.button} ${s.danger}`} disabled={deleteBusy} onClick={() => void deletePackage()}>{deleteBusy ? '删除中…' : '确认删除'}</button></div>}><p>确定删除“{deleting.name}”吗？删除后不可恢复。</p>{error && <p className={s.error} role="alert">{error}</p>}</Modal>}
  </section>
}
