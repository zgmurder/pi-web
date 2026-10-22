"use client";
import { useState } from 'react'
import { saveTagV2Package, updateTagV2Package, type TagV2DictItem, type TagV2Package, type TagV2PackageTag } from './api'
import { conditionLogic, makeCondition, packageCondition, tagValue, uniqueTags } from './logic'
import { feedbackOptions, type FeedbackNode } from './scope'
import { errorText, Icon, Modal } from './ui'
import s from './tags.module.css'

export function PackageEditor({ item, catalog, feedback, onClose, onSaved }: { item: TagV2Package | null; catalog: TagV2DictItem[]; feedback: FeedbackNode[]; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const initial = item ? packageCondition(item) : { unit: 'single' as const, match: 'all' as const, groups: [[]] as TagV2PackageTag[][] }
  const [name, setName] = useState(item?.name || '')
  const [remark, setRemark] = useState(item?.remark || '')
  const [unit, setUnit] = useState(initial.unit)
  const [match, setMatch] = useState(initial.match)
  const [groups, setGroups] = useState(initial.groups)
  const [active, setActive] = useState(0)
  const [tab, setTab] = useState('tagging')
  const [alarmTab, setAlarmTab] = useState<FeedbackNode['level']>('category')
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const tags = uniqueTags(groups)
  const feedbackTags: TagV2DictItem[] = feedbackOptions(feedback, alarmTab).map(option => { const level = { category: '类别', type: '类型', subtype: '细类' }[alarmTab]; return { id: `feedback:${alarmTab}:${option.value}`, tagCode: option.value, domain: '警情标签', level1: level, tagPath: `警情标签/${level}/${option.value}/${option.label}`, name: option.label, category: level, source: 'feedback' } })
  const sources: Record<string, TagV2DictItem[]> = { prior: catalog.filter(tag => tag.source === 'prior'), zj: catalog.filter(tag => tag.source === 'zj'), tagging: catalog.filter(tag => !tag.source), alarm: feedbackTags }
  const filtered = sources[tab].filter(tag => keyword.trim().toLowerCase().split(/\s+/).every(word => [tag.name, tag.tagPath, tag.tagRule, tag.level2, tag.level3, tag.level4].join('|').toLowerCase().includes(word)))
  function toggle(tag: TagV2DictItem) {
    const index = unit === 'single' ? 0 : active
    const value: TagV2PackageTag = { id: tag.id, name: tag.name, tagPath: tag.tagPath, category: tag.domain, source: tag.source || tag.domain }
    setGroups(current => current.map((group, i) => i !== index ? group : group.some(t => t.id === tag.id && t.tagPath === tag.tagPath) ? group.filter(t => !(t.id === tag.id && t.tagPath === tag.tagPath)) : [...group, value]))
  }
  function changeUnit(value: 'single' | 'groups') {
    if (value === unit) return
    if (value === 'single') { setGroups([tags]); setActive(0) }
    else { setGroups(tags.length ? [tags, []] : [[]]); setActive(tags.length ? 1 : 0) }
    setUnit(value)
  }
  async function save() {
    if (saving) return
    if (!name.trim()) { setError('请输入组合名称'); return }
    if (!tags.length) { setError('请至少添加一个标签'); return }
    setSaving(true); setError('')
    try {
      const condition = makeCondition(unit, match, groups)
      const payload = { name: name.trim(), remark: remark.trim(), tags, logic: conditionLogic(condition), condition }
      const result = item ? await updateTagV2Package(item.id, payload) : await saveTagV2Package(payload)
      await onSaved(item?.id || result.data.id)
    } catch (error) { setError(errorText(error, '标签组合保存失败')) } finally { setSaving(false) }
  }
  return <Modal title={item ? '修改标签组合' : '新建标签组合'} onClose={() => { if (!saving) onClose() }} footer={<><span className={s.muted}>{tags.length ? `共 ${tags.length} 个条件 · ${unit === 'groups' ? '按多个' : '按单个'} · ${match === 'all' ? '全部满足' : '满足任意一个'}` : '至少添加一个条件才能保存'}</span><div className={s.row}><button className={s.button} disabled={saving} onClick={onClose}>取消</button><button className={`${s.button} ${s.primary}`} disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存组合'}</button></div></>}>
    {error && <p className={`${s.status} ${s.error}`} role="alert">{error}</p>}
    <div className={s.row}><label className={`${s.field} ${s.grow}`}>组合名称<input className={s.control} autoFocus placeholder="如：交通肇事逃逸人员" value={name} onChange={event => setName(event.target.value)} /></label><label className={`${s.field} ${s.grow}`}>备注<input className={s.control} placeholder="说明适用场景或筛选口径" value={remark} onChange={event => setRemark(event.target.value)} /></label></div>
    <div className={s.editor}>
      <section className={`${s.card} ${s.catalog}`}><div className={`${s.body} ${s.stack}`}><div className={s.row}><Icon name="tags" /><strong>标签库</strong><span className={s.muted}>共 {Object.values(sources).reduce((sum, list) => sum + list.length, 0)} 个</span>{unit === 'groups' && <span className={s.chip}>添加到条件组 {active + 1}</span>}</div><input className={`${s.control} ${s.full}`} aria-label="搜索标签名称或路径" placeholder="搜索标签名称 / 路径" value={keyword} onChange={event => setKeyword(event.target.value)} /><div className={s.tabs}>{[['prior', '前科标签'], ['zj', '治安标签'], ['tagging', '警情打标标签'], ['alarm', '警情标签']].map(([key, label]) => <button key={key} className={`${s.button} ${tab === key ? s.primary : ''}`} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}（{sources[key].length}）</button>)}</div>{tab === 'alarm' && <div className={s.tabs}>{(['category', 'type', 'subtype'] as const).map(key => <button key={key} className={`${s.button} ${alarmTab === key ? s.primary : ''}`} aria-pressed={alarmTab === key} onClick={() => setAlarmTab(key)}>{{category:'类别',type:'类型',subtype:'细类'}[key]}（{feedbackOptions(feedback, key).length}）</button>)}</div>}</div><div className={s.scroll}>{filtered.map(tag => <button className={s.poolItem} key={`${tag.id}-${tag.tagPath}`} title={tag.tagRule || tag.tagPath} aria-pressed={(groups[unit === 'single' ? 0 : active] || []).some(t => t.id === tag.id && t.tagPath === tag.tagPath)} onClick={() => toggle(tag)}><div className={s.row}><strong className={s.grow}>{tag.name}</strong>{tags.some(t => t.id === tag.id && t.tagPath === tag.tagPath) ? <span className={s.chip}>已选</span> : <Icon name="plus" />}</div><span className={s.muted}>{['zj', 'prior'].includes(tag.source || '') ? `${tag.level1 || (tag.source === 'zj' ? '治安标签' : '前科标签')} · 关联 ${tag.personCount ?? 0} 人` : tag.source === 'feedback' ? `${tag.level1}代码：${tag.tagCode}` : tag.tagPath}</span></button>)}{!filtered.length && <div className={s.empty}>未匹配到标签</div>}</div></section>
      <section className={`${s.card} ${s.conditions}`}><div className={`${s.body} ${s.stack}`}><div className={s.row}><strong>组合条件</strong><span className={s.chip}>{tags.length}</span><button className={`${s.link} ${s.danger} ${s.end}`} onClick={() => { setGroups([[]]); setActive(0) }}>清空</button></div><div className={s.row}><span className={s.muted}>条件方式</span>{(['single', 'groups'] as const).map(value => <button className={`${s.button} ${unit === value ? s.primary : ''}`} aria-pressed={unit === value} key={value} onClick={() => changeUnit(value)}>{value === 'single' ? '按单个' : '按多个'}</button>)}</div><div className={s.row}><span className={s.muted}>匹配关系</span>{(['all', 'any'] as const).map(value => <button className={`${s.button} ${match === value ? s.primary : ''}`} aria-pressed={match === value} key={value} onClick={() => setMatch(value)}>{value === 'all' ? '全部满足' : '满足任意一个'}</button>)}</div><p className={s.muted}>{unit === 'single' ? match === 'all' ? '所有已选条件都要命中' : '命中任意一个已选条件即可' : match === 'all' ? '每组内全部满足，且所有组都要命中' : '每组内全部满足，命中任意一组即可'}</p></div><div className={`${s.body} ${s.scroll}`}>{groups.map((group, index) => <div key={index} className={`${s.condition} ${unit === 'groups' && active === index ? s.activeGroup : ''}`}>
        {unit === 'groups' && <div className={s.row}><button className={s.link} aria-pressed={active === index} onClick={() => setActive(index)}>条件组 {index + 1}</button><span className={s.muted}>组内全部满足</span>{groups.length > 1 && <button className={`${s.link} ${s.danger} ${s.end}`} onClick={() => { setGroups(current => current.filter((_, i) => i !== index)); setActive(Math.min(active, groups.length - 2)) }}>删除</button>}</div>}
        <div className={s.selectedPaths}>{group.map((tag, tagIndex) => <button className={s.chip} key={`${tagValue(tag)}-${tagIndex}`} title={`${tagValue(tag)}（点击移除）`} onClick={() => setGroups(current => current.map((g, i) => i === index ? g.filter((_, j) => j !== tagIndex) : g))}>{tag.name}<Icon name="close" /></button>)}</div>{!group.length && <p className={s.muted}>{unit === 'groups' ? '点击本组后，从左侧添加条件' : '尚未选择标签，点击左侧标签库添加'}</p>}</div>)}{unit === 'groups' && <button className={`${s.button} ${s.full}`} onClick={() => { setGroups(current => [...current, []]); setActive(groups.length) }}><Icon name="plus" />添加一组</button>}</div><div className={s.header}><span className={s.muted}>共 {tags.length} 个条件{unit === 'groups' ? ` · ${groups.filter(group => group.length).length} 组` : ''} · {match === 'all' ? '全部满足' : '满足任意一个'}</span></div></section>
    </div>
  </Modal>
}
