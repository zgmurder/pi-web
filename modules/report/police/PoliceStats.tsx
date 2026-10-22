"use client";

import { Fragment, useEffect, useRef, useState } from 'react'
import { exportPolice110Stats, postPolice110Stats, type Police110StatKey, type Police110StatsParams, type Police110StatsResult } from './api'
import { CITY_CODE, comparisonRate, dependentOptions, incidentOptions, METRICS, newStatsForm, statsAlarmMethods, statsAlarmTypes, statsPayload, statsQuick, type Option } from './model'
import { formatDateTime } from './datetime'
import { Field, Icon, Radio, RangeInput, Select } from './ui'
import { useDictionaries } from './useDictionaries'
import styles from './police.module.css'

const CMP_LABEL = {yoy:'同比',mom:'环比'}
const valueText=(value:number|null|undefined)=>value==null?'--':String(value)
export default function PoliceStats() {
  const dictionaries=useDictionaries(true), request=useRef(0)
  const [form,setForm]=useState<Police110StatsParams>(newStatsForm), [quick,setQuick]=useState('yesterday')
  const [result,setResult]=useState<Police110StatsResult|null>(null), [loading,setLoading]=useState(false), [exporting,setExporting]=useState(false), [notice,setNotice]=useState('')
  useEffect(()=>()=>{request.current++},[])
  const [categories,types,details]=incidentOptions(dictionaries.incident,form.category_codes || [],form.type_codes || [])
  const [feedbackCategories,feedbackTypes,feedbackDetails]=dependentOptions(dictionaries.feedback,form.feedback_category_code || '',form.feedback_type_code || '')
  const [placeCategories,placeTypes]=dependentOptions(dictionaries.places,form.place_category_code || '')
  const units=[{label:'全市',value:CITY_CODE},...dictionaries.units.filter(o=>o.value!==CITY_CODE)]
  function change<K extends keyof Police110StatsParams>(key:K,value:Police110StatsParams[K]) {setForm(f=>({...f,[key]:value}))}
  function changeFilter(key:keyof Police110StatsParams,values:string[]) {
    setForm(f=> {
      const next={...f,[key]:key.endsWith('_codes') ? values : values[0] || null}
      if(key==='category_codes') {
        const opts=incidentOptions(dictionaries.incident,values,[])
        next.type_codes=(next.type_codes || []).filter(code=>opts[1].some(o=>o.value===code))
      }
      if(key==='category_codes' || key==='type_codes') {
        const opts=incidentOptions(dictionaries.incident,next.category_codes || [],next.type_codes || [])
        next.detail_codes=(next.detail_codes || []).filter(code=>opts[2].some(o=>o.value===code))
      }
      if(key==='feedback_category_code') {next.feedback_type_code=null;next.feedback_detail_code=null}
      if(key==='feedback_type_code') next.feedback_detail_code=null
      if(key==='place_category_code') next.place_type_code=null
      return next
    })
  }
  async function runStats(next=form) {
    if(!next.start_time || !next.end_time) {setNotice('请选择统计时间的开始与结束');return}
    const normalized=statsPayload(next), id=++request.current
    setForm({...normalized,start_time:next.start_time,end_time:next.end_time});setLoading(true);setNotice('')
    try {const data=await postPolice110Stats(normalized);if(id===request.current) setResult(data)}
    catch(e) {if(id===request.current) setNotice(e instanceof Error ? e.message : '统计查询失败')}
    finally {if(id===request.current) setLoading(false)}
  }
  function reset() {request.current++;setLoading(false);setForm(newStatsForm());setQuick('yesterday');setResult(null);setNotice('')}
  async function doExport() {
    if(!form.start_time || !form.end_time) {setNotice('请选择统计时间的开始与结束');return}
    setExporting(true);setNotice('')
    const normalized=statsPayload(form);setForm({...normalized,start_time:form.start_time,end_time:form.end_time})
    try {await exportPolice110Stats(normalized)}
    catch(e) {setNotice(e instanceof Error ? e.message : '导出失败')}
    finally {setExporting(false)}
  }
  function filter(label:string,key:keyof Police110StatsParams,include:keyof Police110StatsParams,opts:Option[],multiple=false) {
    const value=form[key] as string|string[]|null|undefined
    return <Field label={label}><div className={styles.optionRow}><Select label={label} value={value || (multiple?[]:'')} options={opts} multiple={multiple} onChange={v=>changeFilter(key,v)}/><input type="checkbox" aria-label={`包含${label}`} title={`勾选：包含所选${label}；取消勾选：排除所选项`} checked={Boolean(form[include])} disabled={!value?.length} onChange={e=>change(include,e.target.checked)}/></div></Field>
  }
  // Keep a returned result's headers tied to its source, even if the next request fails.
  const source=result?.source || form.source
  const metrics:[Police110StatKey,string][]=source==='jjd'?METRICS:[['total','反馈警情量']]
  const dimensions=result?.dimension_columns || [], rows=result?[result.total_row,...result.rows]:[]
  const comparisons=(['yoy','mom'] as const).filter(c=>result?.compare.includes(c))
  const compareActive=comparisons.length>0 && !dimensions.length
  return <div className={`${styles.page} ${styles.statsPage}`}>
    <aside className={styles.filterPanel}>
      <header className={styles.panelHead}><h1>110 统计</h1><p>{dictionaries.user?.department_name || dictionaries.units.find(u=>u.value===dictionaries.user?.unit_code)?.label || '当前部门'} · 按数据权限统计</p></header>
      <form id="police-stats-form" className={styles.panelBody} onSubmit={e=>{e.preventDefault();void runStats()}}>
        <div className={styles.tabs} role="tablist" aria-label="统计来源">{([['jjd','接警统计'],['fkd','反馈统计']] as const).map(([key,label])=><button type="button" key={key} role="tab" aria-selected={form.source===key} className={form.source===key?styles.activeTab:''} disabled={loading || !dictionaries.user} onClick={()=>{const next={...form,source:key};setForm(next);void runStats(next)}}>{label}</button>)}</div>
        <div className={styles.statsFilters}>
          <Field label="* 统计单位"><Select label="统计单位" value={form.unit_code || CITY_CODE} options={units} placeholder="全市" onChange={v=>change('unit_code',v[0] || CITY_CODE)}/></Field>
          <RangeInput label={`* ${form.source==='jjd'?'报警时间':'反馈时间'}`} value={[form.start_time,form.end_time]} onChange={v=>{setForm(f=>({...f,start_time:v[0],end_time:v[1]}));setQuick('')}} quick={<div className={styles.quick}>{([['today','今日'],['yesterday','昨日'],['week','近7天']] as const).map(([kind,label])=><button type="button" key={kind} className={quick===kind?styles.on:''} onClick={()=>{const [start,end]=statsQuick(kind);setForm(f=>({...f,start_time:start,end_time:end}));setQuick(kind)}}>{label}</button>)}</div>}/>
          {form.source==='jjd' ? <>{filter('报警方式','alarm_method','include_alarm_method',statsAlarmMethods)}{filter('报警类型','alarm_type','include_alarm_type',statsAlarmTypes)}{filter('警情类别','category_codes','include_category',categories,true)}{filter('警情类型','type_codes','include_type',types,true)}{filter('报警细类','detail_codes','include_detail',details,true)}</> : <>{filter('反馈警情类别','feedback_category_code','include_feedback_category',feedbackCategories)}{filter('反馈警情类型','feedback_type_code','include_feedback_type',feedbackTypes)}{filter('反馈警情细类','feedback_detail_code','include_feedback_detail',feedbackDetails)}{filter('发生部位类别','place_category_code','include_place_category',placeCategories)}{filter('发生部位类型','place_type_code','include_place_type',placeTypes)}</>}
          <Field label="比较类型"><div className={styles.compareChecks}>{(['yoy','mom'] as const).map(c=><label key={c}><input type="checkbox" checked={form.compare.includes(c)} onChange={e=>change('compare',e.target.checked?[...form.compare,c]:form.compare.filter(v=>v!==c))}/>{CMP_LABEL[c]}</label>)}</div></Field>
          <div title={form.source==='jjd'?'单位行按派单单位（sjdwdm）归组：县级1=中队并入父单位；县级2=派单单位原样（含中队行）':'单位行按反馈单位（fkdwdm）归组：县级1=中队并入父单位；县级2=反馈单位原样（含中队行）'}><Field label="分析级别"><Radio label="分析级别" value={form.level} options={[{label:'市级',value:'city'},{label:'县级1',value:'l1'},{label:'县级2',value:'l2'}]} onChange={v=>change('level',v as Police110StatsParams['level'])}/></Field></div>
        </div>
      </form>
      <footer className={styles.panelFoot}><span className={styles.spacer}/><button type="button" onClick={reset}><Icon kind="reset"/>重置</button><button form="police-stats-form" type="submit" className={styles.primary} disabled={loading || !dictionaries.user}><Icon kind="search"/>{loading?'统计中…':'统计'}</button></footer>
    </aside>
    <section className={styles.resultPanel} aria-busy={loading} aria-label="统计结果">
      <header className={styles.resultHead}><div><h2>{source==='jjd'?'接警统计':'反馈统计'}</h2>{result && <span>{formatDateTime(result.start_time)} 至 {formatDateTime(result.end_time)} · 级别：{result.level==='city'?'市级':result.level==='l1'?'县级1':'县级2'}{result.compare.length>0 && ` · 对比：${result.compare.map(c=>CMP_LABEL[c as keyof typeof CMP_LABEL] || c).join('/')}`}</span>}</div><button type="button" disabled={exporting || !dictionaries.user} onClick={()=>void doExport()}><Icon kind="download"/>{exporting?'导出中…':'导出 Excel'}</button></header>
      {(notice || dictionaries.warning) && <div className={styles.notes} aria-live="polite">{[dictionaries.warning,notice].filter(Boolean).map((n,i)=><p className={styles.note} key={i}>{n}</p>)}</div>}
      <div className={`${styles.resultBody} ${styles.statsBody}`}>
        {compareActive && result?.base_notes && <div className={styles.baseNotes}>{Object.entries(result.base_notes).map(([key,note])=><p key={key} className={styles.note}>{note}</p>)}</div>}
        {loading && <p role="status" className={styles.loading}>正在统计…</p>}
        {compareActive ? <div className={styles.compareWrap}><table className={styles.compareTable}><thead><tr><th rowSpan={2} scope="col" className={styles.unitCell}>单位</th><th colSpan={2} scope="colgroup">期号</th>{metrics.map(([key,label])=><th scope="col" key={key} rowSpan={2}>{label}</th>)}</tr><tr><th scope="col" aria-label="比较期"/><th scope="col" aria-label="数值或变化率"/></tr></thead><tbody>{rows.map(unit=><Fragment key={unit.unit_code}><tr className={unit.unit_code==='@@TOTAL@@'?styles.totalRow:''}><th scope="rowgroup" rowSpan={1+2*comparisons.length} className={styles.unitCell}>{unit.unit_name}</th><td className={styles.periodCell}>本期</td><td/>{metrics.map(([key])=><td key={key}>{valueText(unit[key])}</td>)}</tr>{comparisons.map(c=><Fragment key={c}><tr><td rowSpan={2} className={styles.periodCell}>{c==='yoy'?'上年同期':'上期'}</td><td className={styles.sub}>数值</td>{metrics.map(([key])=><td key={key}>{valueText(unit[c]?.[key])}</td>)}</tr><tr><td className={styles.sub}>{CMP_LABEL[c]}</td>{metrics.map(([key])=>{const rate=comparisonRate(unit,c,key);return <td key={key} className={rate==null || rate===0?styles.muted:rate>0?styles.up:styles.down}>{rate==null?'--':`${rate.toFixed(1)}%`}</td>})}</tr></Fragment>)}</Fragment>)}</tbody></table></div> : <table className={styles.statsTable} style={{minWidth:dimensions.length?undefined:1400}}><thead><tr><th scope="col" className={styles.unitCell}>单位</th>{dimensions.length ? dimensions.map(d=><th scope="col" key={d.key}>{d.label}</th>) : metrics.map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead><tbody>{rows.map(unit=><tr key={unit.unit_code} className={unit.unit_code==='@@TOTAL@@'?styles.totalRow:''}><th scope="row" className={styles.unitCell} title={unit.unit_name}>{unit.unit_name}</th>{dimensions.length ? dimensions.map(d=><td key={d.key}>{unit.dimensions?.find(v=>v.key===d.key)?.value ?? 0}</td>) : metrics.map(([key])=><td key={key}>{valueText(unit[key])}</td>)}</tr>)}</tbody></table>}
        {!result && !loading && <p className={styles.empty}>暂无数据</p>}
        {result && !result.rows.length && <p className={styles.emptyTip}>无明细数据。{source==='jjd'?'接警统计按派单单位（sjdwdm）归组；有效警情=派单警情；有效接警=剔骚扰/其他/无效警情。':'反馈统计按反馈时间筛选正式反馈单（fkzj=1），按警情单号去重、按反馈单位（fkdwdm）归组。'}</p>}
      </div>
    </section>
  </div>
}
