import { apiGet } from '../api/client'
import { collectDeptScopeIds, flattenDepartmentTree, type DepartmentItem, type DeptOption } from './deptTree'
export interface ScopeUser { unit_code?: string; department_name?: string; is_root_department?: boolean; root_department_code?: string }
export interface Scope { user: ScopeUser; depts: DeptOption[]; defaultKey: string }
export async function loadScope(): Promise<Scope> {
  const [user, tree] = await Promise.all([apiGet<ScopeUser>('/auth/me'), apiGet<DepartmentItem[]>('/departments/tree')])
  if (!user || (!user.is_root_department && !String(user.unit_code || '').trim())) {
    throw new Error('当前账号缺少部门范围，已停止查询；请联系管理员配置部门。')
  }
  user.unit_code = String(user.unit_code || '').trim()
  user.root_department_code = String(user.root_department_code || '').trim()
  const flat = flattenDepartmentTree(tree)
  const own = flat.find(dept => dept.deptCode === user.unit_code)
  // Fail closed in the picker if an account department cannot be resolved. Backend remains authoritative.
  const ids = own ? collectDeptScopeIds(flat, own.deptId) : null
  const depts = user.is_root_department ? flat : ids ? flat.filter(dept => ids.has(dept.deptId)) : []
  return { user, depts, defaultKey: user.is_root_department ? '' : own ? String(own.deptId) : '' }
}
export function departmentFilter(scope: Scope, key: string, withName = false) {
  const dept = scope.depts.find(item => String(item.deptId) === key)
  const code = dept?.deptCode || (!scope.user.is_root_department ? scope.user.unit_code : '')
  if (code && code === scope.user.root_department_code) return {}
  return { fkdwdm: code || undefined, ...(withName ? { fkdwmc: dept?.deptName || (!scope.user.is_root_department ? scope.user.department_name : undefined) } : {}) }
}
export interface FeedbackNode { code: string; name: string; level: 'category' | 'type' | 'subtype'; children?: FeedbackNode[] }
export async function loadFeedback(): Promise<FeedbackNode[]> {
  try { return await apiGet<FeedbackNode[]>('/components/feedback-category-tree') } catch {
    const levels = await Promise.all(['category', 'type', 'detail'].map(level => apiGet<{ items: { code: string; name: string }[] }>('/report-search/classifications', { source: 'fkd_fkd', level })))
    // Original fallback is flat: never invent parent relationships for filtering.
    return levels.flatMap((result, index) => (result.items || []).map(item => ({ ...item, level: (['category', 'type', 'subtype'] as const)[index] })))
  }
}
export function feedbackOptions(nodes: FeedbackNode[], level: FeedbackNode['level']) {
  const map = new Map<string, { value: string; label: string }>()
  function walk(items: FeedbackNode[]) { items.forEach(item => { if (item.level === level) map.set(item.code, { value: item.code, label: item.name }); if (item.children) walk(item.children) }) }
  walk(nodes); return [...map.values()]
}
