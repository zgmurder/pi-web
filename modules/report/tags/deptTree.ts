export interface DepartmentItem {
  id: number; name: string; code: string; parent_id?: number | null; sort_order: number; children?: DepartmentItem[]
}
export interface TreeOption { key: string; label: string; children?: TreeOption[] }

/** 与旧模板部门选项对齐，供工作台页面使用 */
export interface DeptOption {
  deptId: number
  deptName: string
  deptCode: string
  parentId: number
  orderNum: number
}

export interface FlatDeptTreeNode {
  key: string
  label: string
  depth: number
  hasChildren: boolean
  expanded: boolean
}

export function flattenDepartmentTree(items: DepartmentItem[], parentId = 0): DeptOption[] {
  const rows: DeptOption[] = []
  items.forEach((item) => {
    const deptId = Number(item.id || 0)
    rows.push({
      deptId,
      deptName: item.name || item.code || String(deptId),
      deptCode: item.code || String(deptId),
      parentId: item.parent_id == null ? parentId : Number(item.parent_id),
      orderNum: Number(item.sort_order || 0),
    })
    if (item.children?.length) {
      rows.push(...flattenDepartmentTree(item.children, deptId))
    }
  })
  return rows
}

export function buildDeptTreeOptions(depts: DeptOption[]): TreeOption[] {
  const sorted = [...depts].sort((a, b) => {
    const orderDiff = Number(a.orderNum || 0) - Number(b.orderNum || 0)
    if (orderDiff) return orderDiff
    return String(a.deptName || '').localeCompare(String(b.deptName || ''), 'zh-CN')
  })

  const nodeMap = new Map<number, TreeOption>()
  sorted.forEach((dept) => {
    const deptId = Number(dept.deptId || 0)
    if (!deptId) return
    nodeMap.set(deptId, {
      key: String(deptId),
      label: dept.deptName || dept.deptCode || String(deptId),
      children: [],
    })
  })

  const roots: TreeOption[] = []
  sorted.forEach((dept) => {
    const deptId = Number(dept.deptId || 0)
    if (!deptId) return
    const node = nodeMap.get(deptId)
    if (!node) return
    const parentId = Number(dept.parentId || 0)
    const parent = parentId ? nodeMap.get(parentId) : undefined
    if (parent) {
      parent.children = parent.children || []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const pruneEmptyChildren = (nodes: TreeOption[]) => {
    nodes.forEach((node) => {
      if (node.children?.length) pruneEmptyChildren(node.children)
      else delete node.children
    })
  }
  pruneEmptyChildren(roots)

  return roots
}

export function collectDeptScopeIds(depts: DeptOption[], rootDeptId: number | null) {
  if (!rootDeptId) return null
  const ids = new Set<number>([rootDeptId])
  let changed = true
  while (changed) {
    changed = false
    depts.forEach((dept) => {
      const deptId = Number(dept.deptId || 0)
      const parentId = Number(dept.parentId || 0)
      if (!deptId || !parentId) return
      if (ids.has(parentId) && !ids.has(deptId)) {
        ids.add(deptId)
        changed = true
      }
    })
  }
  return ids
}

export function filterDeptTreeOptions(nodes: TreeOption[], keyword: string): TreeOption[] {
  const query = keyword.trim().toLowerCase()
  if (!query) return nodes

  const walk = (items: TreeOption[]): TreeOption[] => {
    const result: TreeOption[] = []
    items.forEach((item) => {
      const label = String(item.label || '').toLowerCase()
      const children = item.children?.length ? walk(item.children) : []
      const matched = label.includes(query)
      if (matched || children.length) {
        result.push({
          ...item,
          children: children.length ? children : undefined,
        })
      }
    })
    return result
  }

  return walk(nodes)
}

export function collectExpandedKeys(nodes: TreeOption[]): string[] {
  const keys: string[] = []
  const walk = (items: TreeOption[]) => {
    items.forEach((item) => {
      const key = String(item.key || '')
      if (key && item.children?.length) {
        keys.push(key)
        walk(item.children)
      }
    })
  }
  walk(nodes)
  return keys
}

export function collectAllDeptTreeKeys(nodes: TreeOption[]): string[] {
  const keys: string[] = []
  const walk = (items: TreeOption[]) => {
    items.forEach((item) => {
      const key = String(item.key || '')
      if (key) keys.push(key)
      if (item.children?.length) walk(item.children)
    })
  }
  walk(nodes)
  return keys
}

export function collectRootDeptTreeKeys(nodes: TreeOption[]): string[] {
  return nodes.map((item) => String(item.key || '')).filter(Boolean)
}

export function findDeptTreeNode(nodes: TreeOption[], targetKey: string): TreeOption | null {
  for (const node of nodes) {
    const key = String(node.key || '')
    if (key === targetKey) return node
    if (node.children?.length) {
      const found = findDeptTreeNode(node.children, targetKey)
      if (found) return found
    }
  }
  return null
}

export function findDeptTreeSiblingKeys(nodes: TreeOption[], targetKey: string): string[] | null {
  for (const node of nodes) {
    const siblings = nodes.map((item) => String(item.key || '')).filter(Boolean)
    if (String(node.key) === targetKey) return siblings
    if (node.children?.length) {
      const found = findDeptTreeSiblingKeys(node.children, targetKey)
      if (found) return found
    }
  }
  return null
}

export function collectDeptTreeDescendantKeys(nodes: TreeOption[], rootKey: string): string[] {
  const node = findDeptTreeNode(nodes, rootKey)
  if (!node?.children?.length) return []
  const keys: string[] = []
  const walk = (items: TreeOption[]) => {
    items.forEach((item) => {
      const key = String(item.key || '')
      if (key) keys.push(key)
      if (item.children?.length) walk(item.children)
    })
  }
  walk(node.children)
  return keys
}

export function getDefaultDeptTreeKey(nodes: TreeOption[]) {
  return nodes.length ? String(nodes[0].key || '') : ''
}

export function isDeptTreeKeyValid(nodes: TreeOption[], key: string) {
  if (!key) return false
  let matched = false
  const walk = (items: TreeOption[]) => {
    items.forEach((item) => {
      if (String(item.key) === key) matched = true
      if (item.children?.length) walk(item.children)
    })
  }
  walk(nodes)
  return matched
}

function readReportCount(
  deptKey: string,
  reportCountByKey: Map<string, number> | ReadonlyMap<string, number>,
) {
  return reportCountByKey.get(deptKey) || 0
}

export function sortDeptTreeByReportCount(
  nodes: TreeOption[],
  reportCountByKey: Map<string, number> | ReadonlyMap<string, number>,
): TreeOption[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const countA = readReportCount(String(a.node.key || ''), reportCountByKey)
      const countB = readReportCount(String(b.node.key || ''), reportCountByKey)
      if (countA > 0 && countB === 0) return -1
      if (countA === 0 && countB > 0) return 1
      return a.index - b.index
    })
    .map(({ node }) => {
      if (!node.children?.length) return { ...node }
      return {
        ...node,
        children: sortDeptTreeByReportCount(node.children, reportCountByKey),
      }
    })
}

export function filterDeptTreeByReportPresence(
  nodes: TreeOption[],
  reportCountByKey: Map<string, number> | ReadonlyMap<string, number>,
): TreeOption[] {
  const walk = (items: TreeOption[]): TreeOption[] => {
    const result: TreeOption[] = []
    items.forEach((item) => {
      const children = item.children?.length ? walk(item.children) : []
      const hasOwnReports = readReportCount(String(item.key || ''), reportCountByKey) > 0
      if (!hasOwnReports && !children.length) return
      result.push({
        ...item,
        children: children.length ? children : undefined,
      })
    })
    return result
  }
  return walk(nodes)
}

export function flattenVisibleDeptTree(
  nodes: TreeOption[],
  expandedKeys: Set<string>,
  depth = 0,
): FlatDeptTreeNode[] {
  const rows: FlatDeptTreeNode[] = []
  nodes.forEach((node) => {
    const key = String(node.key || '')
    const hasChildren = Boolean(node.children?.length)
    const expanded = expandedKeys.has(key)
    rows.push({
      key,
      label: String(node.label || ''),
      depth,
      hasChildren,
      expanded,
    })
    if (hasChildren && expanded) {
      rows.push(...flattenVisibleDeptTree(node.children!, expandedKeys, depth + 1))
    }
  })
  return rows
}
