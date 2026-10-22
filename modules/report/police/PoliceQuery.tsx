"use client";

import { useEffect, useRef, useState } from 'react'
import { exportPoliceEvents, searchPoliceEvents, type PoliceEventRow } from './api'
import { alarmMethods, alarmTypes, classificationOptions, districts, handleTypes, newQueryForm, orgCategories, queryPayload, queryQuick, QUICK_LABELS, TAG_KEYS, TAG_LABELS, type Option, type QueryForm, type QueryTab, type QuickKind, type Range } from './model'
import { formatDateTime } from './datetime'
import { maskCjqkText } from './privacyMask'
import { Drawer, Field, Icon, Radio, RangeInput, Select } from './ui'
import { useDictionaries } from './useDictionaries'
import styles from './police.module.css'

const COLUMNS: {key:keyof PoliceEventRow;label:string;width:number}[] = [
  {key:'alarm_no',label:'接警单编号',width:150},{key:'alarm_time',label:'报警时间',width:158},{key:'alarm_phone',label:'报警电话',width:118},{key:'summary',label:'报警内容',width:220},{key:'unit_name',label:'管辖单位',width:128},{key:'receive_unit',label:'接警单位',width:128},{key:'alarm_method',label:'报警方式',width:104},{key:'handle_type',label:'处理类型',width:104},{key:'alarm_type',label:'报警类型',width:96},{key:'contact_phone',label:'联系电话',width:118},{key:'officer',label:'责任民警',width:92},{key:'address',label:'接警单警情地址',width:180},{key:'jq_tags',label:'警情标签',width:140},{key:'event_type',label:'接警单警情类型',width:150},{key:'category_name',label:'接警单警情类别',width:148},{key:'final_type_name',label:'最终反馈警情大类',width:150},{key:'handle_result',label:'现场反馈处置结果',width:148},{key:'final_feedback',label:'最终反馈内容',width:220},{key:'final_category_name',label:'最终反馈警情类别',width:148},{key:'final_detail_name',label:'最终反馈警情小类',width:150},{key:'sensitive',label:'脱敏标记',width:60},
]
const LABELS:Record<string,string> = {hour_start:'报警时段起始',hour_end:'报警时段结束',alarm_no:'接警单号',phone:'电话',keyword:'报警内容',address:'警情地址',jq_keyword:'警情详址',content_max_len:'报警内容字数少于',alarm_type:'报警类型',alarm_method:'报警方式',jj_unit_code:'接警单位',unit_code:'管辖单位',handle_unit_code:'处置单位',district_code:'警情地域',org_category:'机构类别',category_code:'警情类别',type_code:'警情大类',detail_code:'警情小类',community:'社区',officer:'责任民警',feedback_category_code:'现场警情类别',feedback_type_code:'现场警情大类',feedback_detail_code:'现场警情小类',street_code:'街道乡镇',community_code:'所属社区',complex_code:'所属小区',foreign_related:'涉外',on_scene:'有无现场',evidence_collected:'是否取证',feedback_no:'反馈单号',feedback_keyword:'最终反馈内容',feedback_max_len:'反馈内容字数少于',feedback_finished:'警单反馈终结',...Object.fromEntries(TAG_KEYS.map((k,i)=>[k,TAG_LABELS[i]]))}
const visibleText=(row:PoliceEventRow,value?:string|null)=>row.sensitive ? maskCjqkText(value) : String(value || '')
function cellText(row:PoliceEventRow,key:keyof PoliceEventRow) {
  if(key==='sensitive') return row.sensitive ? '脱敏' : ''
  if(key==='alarm_time') return formatDateTime(row.alarm_time) || '-'
  if(['summary','address','jq_tags','final_feedback','feedback'].includes(key)) return visibleText(row,String(row[key] || '')) || '-'
  return String(row[key] ?? (key==='category_name' ? '未分类' : '-')) || (key==='category_name' ? '未分类' : '-')
}

export default function PoliceQuery() {
  const dictionaries=useDictionaries(), initialized=useRef(false), request=useRef(0)
  const [form,setForm]=useState<QueryForm>(()=>newQueryForm()), [tab,setTab]=useState<QueryTab>('alarm')
  const [rows,setRows]=useState<PoliceEventRow[]>([]), [total,setTotal]=useState(0), [notes,setNotes]=useState<string[]>([])
  const [searched,setSearched]=useState(false), [loading,setLoading]=useState(false), [exporting,setExporting]=useState(false), [notice,setNotice]=useState('')
  const [detail,setDetail]=useState<PoliceEventRow|null>(null), [visible,setVisible]=useState<string[]>(COLUMNS.map(c=>c.key))
  const [alarmQuick,setAlarmQuick]=useState<QuickKind|null>(null), [feedbackQuick,setFeedbackQuick]=useState<QuickKind|null>(null)
  const [category,type,subtype]=classificationOptions(dictionaries.incident), [feedbackCategory,feedbackType,feedbackDetail]=classificationOptions(dictionaries.feedback)
  const optionMap:Record<string,Option[]>={category_code:category,type_code:type,detail_code:subtype,feedback_category_code:feedbackCategory,feedback_type_code:feedbackType,feedback_detail_code:feedbackDetail,jj_unit_code:dictionaries.units,unit_code:dictionaries.units,handle_unit_code:dictionaries.units,community_code:dictionaries.communities,street_code:dictionaries.streets,district_code:districts,alarm_type:alarmTypes,alarm_method:alarmMethods,org_category:orgCategories}
  const update=(key:string,value:string)=>setForm(f=>({...f,values:{...f.values,[key]:value}}))
  const updateRange=(key:'alarmRange'|'feedbackRange'|'finalFeedbackRange',value:Range)=> { setForm(f=>({...f,[key]:value})); if(key==='alarmRange') setAlarmQuick(null); if(key==='feedbackRange') setFeedbackQuick(null) }
  async function search(next:QueryForm, targetTab=tab) {
    if(targetTab==='tag' && !TAG_KEYS.some(k=>next.values[k])) {setNotice('标签查询：以下条件至少选择一个');return}
    const id=++request.current; setLoading(true);setNotice('');setForm(next)
    try { const data=await searchPoliceEvents(queryPayload(next,targetTab)); if(id!==request.current) return; setRows(data.items || []);setTotal(data.total || 0);setNotes(data.notes || []);setSearched(true) }
    catch(e) { if(id===request.current) setNotice(e instanceof Error ? e.message : '警情查询失败') }
    finally { if(id===request.current) setLoading(false) }
  }
  useEffect(()=> {
    if(!dictionaries.user || initialized.current) return
    initialized.current=true
    const next=newQueryForm(dictionaries.user.root_department_code)
    console.info('[警情查询] React 页面初始化')
    void search(next,'alarm')
    // Initial query must wait for the identity's root-department default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dictionaries.ready,dictionaries.user])
  useEffect(()=>()=>{request.current++},[])
  function reset() {request.current++;setLoading(false);setForm(newQueryForm(dictionaries.user?.root_department_code,false));setRows([]);setTotal(0);setNotes([]);setSearched(false);setAlarmQuick(null);setFeedbackQuick(null);setNotice('')}
  async function doExport(scope:'page'|'all') {
    if(!searched) {setNotice('请先设置条件并查询');return}
    setExporting(true);setNotice('')
    try {await exportPoliceEvents({...queryPayload(form,tab),export_scope:scope,max_rows:10000,fields:visible});setNotice(scope==='all' ? '已导出全部匹配数据（上限 10000 条）' : `已导出当前页 ${rows.length} 条`)}
    catch(e) {setNotice(e instanceof Error ? e.message : '导出失败')}
    finally {setExporting(false)}
  }
  function text(key:string,label:string,placeholder='支持模糊查询',full=false,textarea=false,numeric=false) {return <Field key={key} label={label} full={full}>{textarea ? <textarea aria-label={label} value={form.values[key] || ''} rows={2} placeholder={placeholder} onChange={e=>update(key,e.target.value)} onKeyDown={e=>{if(e.key==='Enter' && !e.nativeEvent.isComposing) {e.preventDefault();void search({...form,page:1})}}}/> : <input aria-label={label} type={numeric ? 'number' : 'text'} min={numeric?1:undefined} max={numeric?100000:undefined} value={form.values[key] || ''} placeholder={placeholder} onChange={e=>update(key,e.target.value)}/>}</Field>}
  function select(key:string,label:string,opts=optionMap[key] || []) {return <Field key={key} label={label}><Select label={label} value={form.values[key] || ''} options={opts} onChange={v=>update(key,v[0] || '')}/></Field>}
  function district(label:string) {return <Field label={label}><div className={styles.districtRow}><Select label={label} value={form.values.district_code || ''} options={districts} onChange={v=>update('district_code',v[0] || '')}/><label className={styles.check}><input type="checkbox" checked={form.district_include_sub} disabled={!form.values.district_code} onChange={e=>setForm(f=>({...f,district_include_sub:e.target.checked}))}/>含下级</label></div></Field>}
  function radio(key:string,label:string,yes='是',no='否') {return <Field label={label}><Radio label={label} value={form.values[key] || ''} onChange={v=>update(key,v)} options={[{label:'不限',value:''},{label:yes,value:'1'},{label:no,value:'0'}]}/></Field>}
  function quick(target:'alarm'|'feedback') {return <div className={styles.quick}>{QUICK_LABELS.map(([kind,label])=><button key={kind} type="button" className={(target==='alarm'?alarmQuick:feedbackQuick)===kind ? styles.on : ''} onClick={()=> {setForm(f=>({...f,[target==='alarm'?'alarmRange':'feedbackRange']:queryQuick(kind)}));(target==='alarm'?setAlarmQuick:setFeedbackQuick)(kind)}}>{label}</button>)}</div>}
  const chips=Object.entries(form.values).filter(([,value])=>Boolean(value)).map(([key,value])=>({key,label:`${LABELS[key] || key} ${optionMap[key]?.find(o=>o.value===value)?.label || (['foreign_related','evidence_collected','feedback_finished'].includes(key) ? value==='1'?'是':'否' : key==='on_scene' ? value==='1'?'有':'无' : value)}${key==='district_code' && form.district_include_sub ? '（含下级）' : ''}`}))
  if(form.handle_types.length) chips.push({key:'handle_types',label:`处理类型 ${form.handle_types.map(v=>handleTypes.find(o=>o.value===v)?.label || v).join('、')}`})
  function clearConditions(keys:string[]) {const next={...form,page:1,values:{...form.values}};for(const key of keys) {if(key==='handle_types') next.handle_types=[];else next.values[key]='';if(key==='district_code') next.district_include_sub=false};void search(next)}
  const columns=COLUMNS.filter(c=>visible.includes(c.key)), pageCount=Math.max(1,Math.ceil(total/form.page_size))
  return <div className={styles.page}>
    <aside className={styles.filterPanel}>
      <header className={styles.panelHead}><h1>警情查询</h1><p>{dictionaries.user?.department_name || dictionaries.units.find(u=>u.value===dictionaries.user?.unit_code)?.label || '当前部门'} · 按数据权限检索</p></header>
      <form id="police-query-form" className={styles.panelBody} onSubmit={e=>{e.preventDefault();void search({...form,page:1})}}>
        <div className={styles.alarmShared}><RangeInput label={`报警时间${tab==='tag'?'（必选）':''}`} value={form.alarmRange} onChange={r=>updateRange('alarmRange',r)} quick={quick('alarm')}/></div>
        <div className={styles.tabs} role="tablist" aria-label="查询类型">{([['alarm','接警查询'],['feedback','反馈查询'],['tag','标签查询']] as const).map(([key,label])=><button type="button" role="tab" aria-selected={tab===key} aria-controls={`query-${key}`} id={`tab-${key}`} key={key} className={tab===key?styles.activeTab:''} onClick={()=>setTab(key)}>{label}</button>)}</div>
        <div role="tabpanel" id={`query-${tab}`} aria-labelledby={`tab-${tab}`} className={styles.filterGrid}>
          {tab==='alarm' && <>
            <Field label="报警时段" full><div className={styles.timeGroup}><input type="time" aria-label="报警时段起始" value={form.values.hour_start || ''} onChange={e=>update('hour_start',e.target.value)}/><span>~</span><input type="time" aria-label="报警时段结束" value={form.values.hour_end || ''} onChange={e=>update('hour_end',e.target.value)}/></div></Field>
            {text('alarm_no','接警单编号')}{select('jj_unit_code','接警单位')}{select('category_code','警情类别')}{select('type_code','警情类型')}{text('phone','报警电话','请输入号码')}{select('alarm_type','报警类型')}{select('alarm_method','报警方式')}
            <Field label="处理类型"><Select label="处理类型" value={form.handle_types} options={handleTypes} multiple onChange={v=>setForm(f=>({...f,handle_types:v}))}/></Field>
            {district('警情区划')}{select('unit_code','管辖单位')}{text('address','警情详址','空白=或，&=与')}{select('handle_unit_code','处置单位')}{select('org_category','机构类别')}{select('detail_code','警情小类')}{text('keyword','报警内容','词1 词2=或，词1&词2=与',true,true)}{text('content_max_len','报警内容字数少于','字数',false,false,true)}{text('jq_keyword','关键字','警情关键字')}
          </>}
          {tab==='feedback' && <>
            <RangeInput label="现场反馈时间" value={form.feedbackRange} onChange={r=>updateRange('feedbackRange',r)} quick={quick('feedback')}/>
            {select('feedback_category_code','现场警情类别')}{select('feedback_type_code','现场警情大类')}{select('feedback_detail_code','现场警情小类')}{select('street_code','街道乡镇')}{select('community_code','所属社区')}{text('complex_code','所属小区','小区代码')}{select('handle_unit_code','属地派出所')}{district('警情地域')}{text('officer','责任民警','民警姓名')}{select('category_code','警情类别')}{select('type_code','警情大类')}{select('detail_code','警情小类')}{radio('foreign_related','涉外')}{radio('on_scene','有无现场','有','无')}{radio('evidence_collected','是否取证')}
            <RangeInput label="最终反馈时间" value={form.finalFeedbackRange} onChange={r=>updateRange('finalFeedbackRange',r)}/>
            {text('feedback_no','反馈单号')}{text('address','警情地址','词1 词2=或，词1&词2=与',true,true)}{text('feedback_keyword','最终反馈内容','词1 词2=或，词1&词2=与',true,true)}{text('feedback_max_len','反馈内容字数少于','字数',false,false,true)}{radio('feedback_finished','警单是否反馈终结')}
          </>}
          {tab==='tag' && <><div className={styles.tagHead}>标签信息 <span tabIndex={0} title="标签取自接警单 jqgjz 字段（逗号分隔的标签名），与警情打标无关；标签按父子关系逐级选择，下一级无可用子标签时显示空列表。" aria-label="标签说明">ⓘ</span><span className={styles.required}>以下条件至少选择一个</span></div>{TAG_KEYS.map((key,index)=> {
            const parent=index ? form.values[TAG_KEYS[index-1]] : null
            const opts=index===0 ? dictionaries.tags.map(t=>({label:t.name,value:t.name})) : (dictionaries.tags.find(t=>t.name===parent)?.children || []).map(name=>({label:name,value:name}))
            return <Field key={key} label={TAG_LABELS[index]}><Select label={TAG_LABELS[index]} value={form.values[key] || ''} options={opts} onChange={v=>setForm(f=>({...f,values:{...f.values,[key]:v[0] || '',...Object.fromEntries(TAG_KEYS.slice(index+1).map(k=>[k,'']))}}))}/></Field>
          })}</>}
        </div>
      </form>
      <footer className={styles.panelFoot}><span className={styles.spacer}/><span className={styles.version} title="原页面版本">20261008-7</span><button type="button" onClick={reset}><Icon kind="reset"/>重置</button><button form="police-query-form" type="submit" className={styles.primary} disabled={loading || !dictionaries.user}><Icon kind="search"/>{loading?'查询中…':'查询'}</button></footer>
    </aside>
    <section className={styles.resultPanel} aria-label="查询结果" aria-busy={loading}>
      <header className={styles.resultHead}><div><h2>查询结果</h2>{searched && <span>共 {total.toLocaleString()} 条</span>}{searched && chips.length>0 && <div className={styles.chips}>{chips.map(c=><button key={c.key} type="button" onClick={()=>clearConditions([c.key])} aria-label={`移除条件：${c.label}`}>{c.label} ×</button>)}<button type="button" onClick={()=>clearConditions(chips.map(c=>c.key))}>清空</button></div>}</div>
        <div className={styles.resultActions}><details className={styles.fieldPicker}><summary>选择显示字段</summary><div className={styles.fieldPickerMenu}><div className={styles.fieldPickerHead}><label><input type="checkbox" checked={visible.length===COLUMNS.length} ref={node=>{if(node) node.indeterminate=visible.length>0 && visible.length<COLUMNS.length}} onChange={e=>setVisible(e.target.checked?COLUMNS.map(c=>c.key):[])}/>全选</label><span>已选 {visible.length}/{COLUMNS.length}</span></div><div className={styles.fieldPickerList}>{COLUMNS.map(c=><label key={c.key}><input type="checkbox" checked={visible.includes(c.key)} onChange={e=>setVisible(v=>e.target.checked?[...v,c.key]:v.filter(k=>k!==c.key))}/>{c.label}</label>)}</div></div></details><button type="button" className={styles.primary} disabled={exporting} onClick={()=>void doExport('page')}>导出当前页</button><button type="button" className={styles.primary} disabled={exporting} onClick={()=>void doExport('all')}>{exporting?'导出中…':'全部导出'}</button><select aria-label="每页条数" value={form.page_size} onChange={e=>void search({...form,page:1,page_size:Number(e.target.value)})}>{[20,50,100].map(n=><option key={n} value={n}>{n} 条/页</option>)}</select></div>
      </header>
      {(notice || dictionaries.warning || notes.length>0) && <div className={styles.notes} aria-live="polite">{[dictionaries.warning,notice,...notes].filter(Boolean).map((n,i)=><p className={styles.note} key={i}>{n}</p>)}</div>}
      <div className={styles.resultBody}>{(loading || !dictionaries.ready) && <p role="status" className={styles.loading}>{loading?'正在查询…':'正在加载查询字典…'}</p>}<table className={styles.queryTable} style={{minWidth:columns.reduce((sum,c)=>sum+c.width,0)}}><thead><tr>{columns.map(c=><th scope="col" key={c.key} style={{width:c.width}} className={c.key==='alarm_no'?styles.fixedFirst:c.key==='alarm_time' && visible.includes('alarm_no')?styles.fixedSecond:c.key==='sensitive'?styles.fixedRight:undefined}>{c.label==='脱敏标记'?'':c.label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} tabIndex={0} aria-label={`查看警情 ${row.alarm_no || row.id}`} onClick={()=>setDetail(row)} onKeyDown={e=>{if(e.key==='Enter' || e.key===' ') {e.preventDefault();setDetail(row)}}}>{columns.map(c=><td key={c.key} title={cellText(row,c.key)} style={{maxWidth:c.width}} className={c.key==='alarm_no'?styles.fixedFirst:c.key==='alarm_time' && visible.includes('alarm_no')?styles.fixedSecond:c.key==='sensitive'?styles.fixedRight:undefined}>{c.key==='sensitive' && row.sensitive ? <span className={styles.sensitive}>脱敏</span>:cellText(row,c.key)}</td>)}</tr>)}</tbody></table>{!rows.length && !loading && <p className={styles.empty}>{searched?'未找到符合条件的警情':'请设置条件后查询'}</p>}{!columns.length && rows.length>0 && <p className={styles.empty}>请选择显示字段</p>}</div>
      {total>0 && <footer className={styles.pagination}><span>显示 {(form.page-1)*form.page_size+1}-{Math.min(form.page*form.page_size,total)} 条</span><div><button type="button" disabled={loading || form.page<=1} onClick={()=>void search({...form,page:form.page-1})}>上一页</button><label>页码 <input aria-label="页码" type="number" min={1} max={pageCount} key={`${form.page}-${pageCount}`} defaultValue={form.page} onKeyDown={e=> {if(e.key==='Enter') {const page=Number(e.currentTarget.value);if(Number.isInteger(page)&&page>=1&&page<=pageCount) void search({...form,page})}}} onBlur={e=>{const page=Number(e.target.value);if(Number.isInteger(page)&&page>=1&&page<=pageCount&&page!==form.page) void search({...form,page})}}/> / {pageCount}</label><button type="button" disabled={loading || form.page>=pageCount} onClick={()=>void search({...form,page:form.page+1})}>下一页</button></div></footer>}
    </section>
    {detail && <Drawer title="警情详情" onClose={()=>setDetail(null)}><div className={styles.detailTitle}><div><span className={styles.badge}>{detail.category_name || '未分类'}</span><h2>{detail.event_type || '未知类型'}</h2></div>{detail.sensitive && <span className={styles.sensitive}>敏感警情</span>}</div><dl className={styles.detailGrid}>{([['接警单号',detail.alarm_no],['反馈单号',detail.feedback_no],['报警时间',formatDateTime(detail.alarm_time)],['反馈时间',formatDateTime(detail.feedback_time)],['管辖单位',detail.unit_name],['责任民警',detail.officer],['警情地址',visibleText(detail,detail.address)],['警情标签',visibleText(detail,detail.jq_tags)],['所属社区',detail.community]]).map(([label,value],i)=><div className={i>=6?styles.full:''} key={label}><dt>{label}</dt><dd>{value || '-'}</dd></div>)}</dl><div className={styles.detailBlock}><h3>报警内容</h3><p>{visibleText(detail,detail.summary) || '暂无'}</p></div><div className={styles.detailBlock}><h3>处警反馈</h3><p>{visibleText(detail,detail.feedback) || '暂无反馈'}</p></div></Drawer>}
  </div>
}
