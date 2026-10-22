"use client";
import { useEffect, useState } from 'react'
import { apiGet } from '../api/client'
import { getPolice110CategoryOptions, getPolice110FeedbackCategoryOptions, getPolice110PlaceOptions, getPoliceCommunityOptions, getPoliceStreetOptions, getPoliceTagOptions, type Police110CategoryOption, type Police110PlaceOption, type PoliceTagOption } from './api'
import type { Option } from './model'
interface Department {id:number;code:string;name:string;children?:Department[]}
interface User {department_name?:string;root_department_code?:string;unit_code?:string}
function flatten(items:Department[]):Option[] { return items.flatMap(d=>[{label:d.name || d.code || String(d.id),value:d.code || String(d.id)},...flatten(d.children || [])]) }
export function useDictionaries(stats=false) {
  const [data,setData]=useState({ready:false,user:null as User|null,units:[] as Option[],incident:[] as Police110CategoryOption[],feedback:[] as Police110CategoryOption[],places:[] as Police110PlaceOption[],communities:[] as Option[],streets:[] as Option[],tags:[] as PoliceTagOption[],warning:''})
  useEffect(()=> {
    let live=true
    void (async()=> {
      const identity=apiGet<User>('/auth/me').then(user=> {if(live) setData(previous=>({...previous,user}));return user})
      const results=await Promise.allSettled([identity,apiGet<Department[]>('/departments/tree'),getPolice110CategoryOptions(),getPolice110FeedbackCategoryOptions(),stats ? getPolice110PlaceOptions() : Promise.resolve([] as Police110PlaceOption[]),stats ? Promise.resolve([]) : getPoliceCommunityOptions(),stats ? Promise.resolve([]) : getPoliceStreetOptions(),stats ? Promise.resolve([] as PoliceTagOption[]) : getPoliceTagOptions()] as const)
      if(!live) return
      const [user,depts,incident,feedback,places,communities,streets,tags]=results
      setData({ready:true,user:user.status==='fulfilled' ? user.value : null,units:depts.status==='fulfilled' ? flatten(depts.value) : [],incident:incident.status==='fulfilled' ? incident.value : [],feedback:feedback.status==='fulfilled' ? feedback.value : [],places:places.status==='fulfilled' ? places.value : [],communities:communities.status==='fulfilled' ? communities.value.map(d=>({label:`${d.name}（${d.code}）`,value:d.code})) : [],streets:streets.status==='fulfilled' ? streets.value.map(d=>({label:d.name,value:d.code})) : [],tags:tags.status==='fulfilled' ? tags.value : [],warning:user.status==='rejected' ? '当前用户信息加载失败，无法初始化数据权限，请刷新重试' : results.some(r=>r.status==='rejected') ? `部分${stats?'统计':'查询'}字典加载失败${stats?'':'，可使用关键词继续查询'}` : ''})
    })()
    return ()=> {live=false}
  },[stats])
  return data
}
