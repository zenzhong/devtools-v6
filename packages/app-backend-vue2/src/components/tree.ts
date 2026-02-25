import type { AppRecord, BackendContext, DevtoolsApi } from '@vue-devtools/app-backend-api'
import { SharedData, classify, kebabize } from '@vue-devtools/shared-utils'
import type { ComponentInstance, ComponentTreeNode } from '@vue/devtools-api'
import { getRootElementsFromComponentInstance } from './el'
import { applyPerfHooks } from './perf.js'
import { applyTrackingUpdateHook } from './update-tracking.js'
import { getInstanceName, getRenderKey, getUniqueId, isBeingDestroyed } from './util'

let instanceMap: Map<any, any> = new Map()
let functionalVnodeMap: Map<any, any> = new Map()

export function getInstanceMap() {
  return instanceMap
}

export function getFunctionalVnodeMap() {
  return functionalVnodeMap
}

let appRecord: AppRecord
let api: DevtoolsApi

const consoleBoundInstances = Array(5)

let filter = ''
let recursively = false
const functionalIds = new Map()

// Dedupe instances
// Some instances may be both on a component and on a child abstract/functional component
const captureIds = new Map()

export async function walkTree(instance, pFilter: string, pRecursively: boolean, api: DevtoolsApi, ctx: BackendContext): Promise<ComponentTreeNode[]> {
  initCtx(api, ctx)
  filter = pFilter
  recursively = pRecursively
  functionalIds.clear()
  captureIds.clear()
  const result: ComponentTreeNode[] = flatten(await findQualifiedChildren(instance))
  return result
}

export function getComponentParents(instance, api: DevtoolsApi, ctx: BackendContext) {
  initCtx(api, ctx)
  const captureIds = new Map()

  const captureId = (vm) => {
    const id = vm.__VUE_DEVTOOLS_UID__ = getUniqueId(vm)
    if (captureIds.has(id)) {
      return
    }
    captureIds.set(id, undefined)
    if (vm.__VUE_DEVTOOLS_FUNCTIONAL_LEGACY__) {
      markFunctional(id, vm.vnode)
    }
    else {
      mark(vm)
    }
  }

  const parents = []
  captureId(instance)
  let parent = instance
  // eslint-disable-next-line no-cond-assign
  while ((parent = parent.$parent)) {
    captureId(parent)
    parents.push(parent)
  }
  return parents
}

function initCtx(_api: DevtoolsApi, ctx: BackendContext) {
  appRecord = ctx.currentAppRecord
  api = _api
  if (!appRecord.meta) {
    appRecord.meta = {}
  }
  if (!appRecord.meta.instanceMap) {
    appRecord.meta.instanceMap = new Map()
  }
  instanceMap = appRecord.meta.instanceMap
  if (!appRecord.meta.functionalVnodeMap) {
    appRecord.meta.functionalVnodeMap = new Map()
  }
  functionalVnodeMap = appRecord.meta.functionalVnodeMap
}

/**
 * Iterate through an array of instances and flatten it into
 * an array of qualified instances. This is a depth-first
 * traversal - e.g. if an instance is not matched, we will
 * recursively go deeper until a qualified child is found.
 */
function findQualifiedChildrenFromList(instances: any[]): Promise<ComponentTreeNode[]> {
  instances = instances
    .filter(child => !isBeingDestroyed(child))
  return Promise.all(!filter
    ? instances.map(capture)
    : Array.prototype.concat.apply([], instances.map(findQualifiedChildren)))
}

/**
 * Find qualified children from a single instance.
 * If the instance itself is qualified, just return itself.
 * This is ok because [].concat works in both cases.
 */
async function findQualifiedChildren(instance): Promise<ComponentTreeNode[]> {
  const matchResult = getMatchResult(instance)
  if (matchResult.matched) {
    const node = await capture(instance)
    // 给直接匹配的节点添加 matched tag
    if (filter && node) {
      if (matchResult.matchSource === 'data' && matchResult.matchedFields?.length) {
        const fieldsLabel = matchResult.matchedFields.length <= 2
          ? matchResult.matchedFields.join(', ')
          : `${matchResult.matchedFields.slice(0, 2).join(', ')} +${matchResult.matchedFields.length - 2}`
        node.tags.push({
          label: fieldsLabel,
          textColor: 0xFFFFFF,
          backgroundColor: 0xE67E22,
          tooltip: `Matched fields: ${matchResult.matchedFields.join(', ')}`,
        })
      }
      else {
        node.tags.push({
          label: 'matched',
          textColor: 0xFFFFFF,
          backgroundColor: 0x42B983,
        })
      }
      // capture 已递归生成子树，遍历子节点给匹配的也打 tag
      markMatchedChildren(node)
    }
    return [node]
  }
  else {
    let children = await findQualifiedChildrenFromList(instance.$children)

    // Find functional components in recursively in non-functional vnodes.
    if (instance._vnode && instance._vnode.children) {
      const list = await Promise.all(flatten<Promise<ComponentTreeNode>>((instance._vnode.children as any[]).filter(child => !child.componentInstance).map(captureChild)))
      // Filter qualified children.
      const additionalChildren = list.filter(instance => isQualified(instance))
      children = children.concat(additionalChildren)
    }

    return children
  }
}

/**
 * 递归遍历已 capture 的子树节点，对匹配搜索词的子组件打 tag
 */
function markMatchedChildren(node: ComponentTreeNode): void {
  if (!node.children || !node.children.length) {
    return
  }
  for (const child of node.children) {
    const instance = instanceMap.get(child.id) || appRecord.instanceMap.get(child.id)
    if (instance) {
      const childMatch = getMatchResult(instance)
      if (childMatch.matched) {
        if (childMatch.matchSource === 'data' && childMatch.matchedFields?.length) {
          const fieldsLabel = childMatch.matchedFields.length <= 2
            ? childMatch.matchedFields.join(', ')
            : `${childMatch.matchedFields.slice(0, 2).join(', ')} +${childMatch.matchedFields.length - 2}`
          child.tags.push({
            label: fieldsLabel,
            textColor: 0xFFFFFF,
            backgroundColor: 0xE67E22,
            tooltip: `Matched fields: ${childMatch.matchedFields.join(', ')}`,
          })
        }
        else {
          child.tags.push({
            label: 'matched',
            textColor: 0xFFFFFF,
            backgroundColor: 0x42B983,
          })
        }
      }
    }
    // 递归标记更深层的子组件
    markMatchedChildren(child)
  }
}

/**
 * Get children from a component instance.
 */
function getInternalInstanceChildren(instance): any[] {
  if (instance.$children) {
    return instance.$children
  }
  return []
}

const SEARCH_MAX_DEPTH = 50

/**
 * 检测值是否为 Vue 2 组件实例
 */
function isVue2Instance(obj: any): boolean {
  if (obj == null || typeof obj !== 'object') {
    return false
  }
  // Vue 2 组件实例的各种特征
  return !!(obj._isVue || obj.__vue__)
}

/**
 * 在 Vue 2 响应式数据中递归搜索
 * 返回匹配到的路径字符串（如 'state.currentAudit.verify_flag'），未匹配返回 null
 */
function searchInObjectData(obj: any, searchTerm: string, seen: Set<any> = new Set(), depth = 0): string | null {
  if (depth > SEARCH_MAX_DEPTH || obj == null) {
    return null
  }

  if (typeof obj !== 'object') {
    return String(obj).toLowerCase().includes(searchTerm) ? '' : null
  }

  if (seen.has(obj)) {
    return null
  }
  seen.add(obj)

  // 跳过 Vue 2 组件实例，避免穿透到子组件数据
  if (isVue2Instance(obj)) {
    return null
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const subPath = searchInObjectData(obj[i], searchTerm, seen, depth + 1)
      if (subPath !== null) {
        const prefix = `[${i}]`
        return subPath ? `${prefix}.${subPath}` : prefix
      }
    }
    return null
  }

  const keys = Object.keys(obj)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    // 匹配 key
    if (key.toLowerCase().includes(searchTerm)) {
      return key
    }
    // 递归匹配 value
    try {
      const subPath = searchInObjectData(obj[key], searchTerm, seen, depth + 1)
      if (subPath !== null) {
        return subPath ? `${key}.${subPath}` : key
      }
    }
    catch {
      // getter 可能抛异常
    }
  }
  return null
}

interface MatchResult {
  matched: boolean
  matchSource?: string
  matchedFields?: string[]
}

/**
 * 检测值是否包含 Vue 实例（直接是实例或数组元素全是实例）
 */
function containsVueInstances(val: any): boolean {
  if (isVue2Instance(val)) {
    return true
  }
  if (Array.isArray(val) && val.length > 0 && val.every(item => isVue2Instance(item))) {
    return true
  }
  return false
}

/**
 * Get detailed match result for an instance.
 */
function getMatchResult(instance): MatchResult {
  const name = getInstanceName(instance)
  // 先匹配组件名称
  if (
    classify(name).toLowerCase().includes(filter)
    || kebabize(name).toLowerCase().includes(filter)
  ) {
    return { matched: true, matchSource: 'name' }
  }

  // 名称不匹配时，根据开关决定是否搜索组件数据
  if (!SharedData.searchComponentData) {
    return { matched: false }
  }
  const matchedFields: string[] = []
  try {
    const props = instance._props
    const data = instance._data
    const setupState = instance._setupProxy || instance._setupState
    if (props) {
      for (const key of Object.keys(props)) {
        try {
          const val = props[key]
          if (containsVueInstances(val)) {
            continue
          }
          if (key.toLowerCase().includes(filter)) {
            matchedFields.push(`$props.${key}`)
          }
          else {
            const subPath = searchInObjectData(val, filter)
            if (subPath !== null) {
              matchedFields.push(subPath ? `$props.${key}.${subPath}` : `$props.${key}`)
            }
          }
        }
        catch {
          // skip
        }
      }
    }
    if (data) {
      for (const key of Object.keys(data)) {
        try {
          const val = data[key]
          if (containsVueInstances(val)) {
            continue
          }
          if (key.toLowerCase().includes(filter)) {
            matchedFields.push(`$data.${key}`)
          }
          else {
            const subPath = searchInObjectData(val, filter)
            if (subPath !== null) {
              matchedFields.push(subPath ? `$data.${key}.${subPath}` : `$data.${key}`)
            }
          }
        }
        catch {
          // skip
        }
      }
    }
    if (setupState) {
      for (const key of Object.keys(setupState)) {
        try {
          const val = setupState[key]
          if (containsVueInstances(val)) {
            continue
          }
          if (key.toLowerCase().includes(filter)) {
            matchedFields.push(`$setup.${key}`)
          }
          else {
            const subPath = searchInObjectData(val, filter)
            if (subPath !== null) {
              matchedFields.push(subPath ? `$setup.${key}.${subPath}` : `$setup.${key}`)
            }
          }
        }
        catch {
          // skip
        }
      }
    }
    // 搜索 computed 属性的值
    const computedDefs = instance.$options && instance.$options.computed
    if (computedDefs) {
      for (const key in computedDefs) {
        if (key.toLowerCase().includes(filter)) {
          matchedFields.push(`$computed.${key}`)
          continue
        }
        try {
          const val = instance[key]
          if (val != null) {
            const subPath = searchInObjectData(val, filter)
            if (subPath !== null) {
              matchedFields.push(subPath ? `$computed.${key}.${subPath}` : `$computed.${key}`)
            }
          }
        }
        catch {
          // computed getter 可能抛异常
        }
      }
    }
  }
  catch {
    // 安全访问
  }
  if (matchedFields.length > 0) {
    return { matched: true, matchSource: 'data', matchedFields }
  }
  return { matched: false }
}

/**
 * Check if an instance is qualified.
 */
function isQualified(instance): boolean {
  return getMatchResult(instance).matched
}

function flatten<T>(items: any[]): T[] {
  const r = items.reduce((acc, item) => {
    if (Array.isArray(item)) {
      let children = []
      for (const i of item) {
        if (Array.isArray(i)) {
          children = children.concat(flatten(i))
        }
        else {
          children.push(i)
        }
      }
      acc.push(...children)
    }
    else if (item) {
      acc.push(item)
    }

    return acc
  }, [] as T[])
  return r
}

function captureChild(child): Promise<ComponentTreeNode[] | ComponentTreeNode> {
  if (child.fnContext && !child.componentInstance) {
    return capture(child)
  }
  else if (child.componentInstance) {
    if (!isBeingDestroyed(child.componentInstance)) {
      return capture(child.componentInstance)
    }
  }
  else if (child.children) {
    return Promise.all(flatten<Promise<ComponentTreeNode>>(child.children.map(captureChild)))
  }
}

/**
 * Capture the meta information of an instance. (recursive)
 */
async function capture(instance, _index?: number, _list?: any[]): Promise<ComponentTreeNode> {
  if (instance.__VUE_DEVTOOLS_FUNCTIONAL_LEGACY__) {
    instance = instance.vnode
  }

  if (instance.$options && instance.$options.abstract && instance._vnode && instance._vnode.componentInstance) {
    instance = instance._vnode.componentInstance
  }

  if (instance.$options?.devtools?.hide) {
    return
  }

  // Functional component.
  if (instance.fnContext && !instance.componentInstance) {
    const contextUid = instance.fnContext.__VUE_DEVTOOLS_UID__
    let id = functionalIds.get(contextUid)
    if (id == null) {
      id = 0
    }
    else {
      id++
    }
    functionalIds.set(contextUid, id)
    const functionalId = `${contextUid}:functional:${id}`
    markFunctional(functionalId, instance)

    const childrenPromise = (instance.children
      ? instance.children.map(
        child => child.fnContext
          ? captureChild(child)
          : child.componentInstance
            ? capture(child.componentInstance)
            : undefined,
      )
      // router-view has both fnContext and componentInstance on vnode.
      : instance.componentInstance ? [capture(instance.componentInstance)] : [])

    // await all childrenCapture to-be resolved
    const children = (await Promise.all(childrenPromise)).filter(Boolean) as ComponentTreeNode[]

    const treeNode = {
      uid: functionalId,
      id: functionalId,
      tags: [
        {
          label: 'functional',
          textColor: 0x555555,
          backgroundColor: 0xEEEEEE,
        },
      ],
      name: getInstanceName(instance),
      renderKey: getRenderKey(instance.key),
      children,
      hasChildren: !!children.length,
      inactive: false,
      isFragment: false, // TODO: Check what is it for.
      autoOpen: recursively,
    }
    return api.visitComponentTree(
      instance,
      treeNode,
      filter,
      appRecord?.options?.app,
    )
  }
  // instance._uid is not reliable in devtools as there
  // may be 2 roots with same _uid which causes unexpected
  // behaviour
  instance.__VUE_DEVTOOLS_UID__ = getUniqueId(instance, appRecord)

  // Dedupe
  if (captureIds.has(instance.__VUE_DEVTOOLS_UID__)) {
    return
  }
  else {
    captureIds.set(instance.__VUE_DEVTOOLS_UID__, undefined)
  }

  mark(instance)
  const name = getInstanceName(instance)

  const children = (await Promise.all((await getInternalInstanceChildren(instance))
    .filter(child => !isBeingDestroyed(child))
    .map(capture))).filter(Boolean)

  const ret: ComponentTreeNode = {
    uid: instance._uid,
    id: instance.__VUE_DEVTOOLS_UID__,
    name,
    renderKey: getRenderKey(instance.$vnode ? instance.$vnode.key : null),
    inactive: !!instance._inactive,
    isFragment: !!instance._isFragment,
    children,
    hasChildren: !!children.length,
    autoOpen: recursively,
    tags: [],
    meta: {},
  }

  if (instance._vnode && instance._vnode.children) {
    const vnodeChildren = await Promise.all(flatten(instance._vnode.children.map(captureChild)))
    ret.children = ret.children.concat(
      flatten<any>(vnodeChildren).filter(Boolean),
    )
    ret.hasChildren = !!ret.children.length
  }

  // ensure correct ordering
  const rootElements = getRootElementsFromComponentInstance(instance)
  const firstElement = rootElements[0]
  if (firstElement?.parentElement) {
    const parentInstance = instance.$parent
    const parentRootElements = parentInstance ? getRootElementsFromComponentInstance(parentInstance) : []
    let el = firstElement
    const indexList = []
    do {
      indexList.push(Array.from(el.parentElement.childNodes).indexOf(el))
      el = el.parentElement
    } while (el.parentElement && parentRootElements.length && !parentRootElements.includes(el))
    ret.domOrder = indexList.reverse()
  }
  else {
    ret.domOrder = [-1]
  }

  // check if instance is available in console
  const consoleId = consoleBoundInstances.indexOf(instance.__VUE_DEVTOOLS_UID__)
  ret.consoleId = consoleId > -1 ? `$vm${consoleId}` : null

  // check router view
  const isRouterView2 = instance.$vnode?.data?.routerView
  if (instance._routerView || isRouterView2) {
    ret.isRouterView = true
    if (!instance._inactive && instance.$route) {
      const matched = instance.$route.matched
      const depth = isRouterView2
        ? instance.$vnode.data.routerViewDepth
        : instance._routerView.depth
      ret.meta.matchedRouteSegment
        = matched
        && matched[depth]
        && (isRouterView2 ? matched[depth].path : matched[depth].handler.path)
    }
    ret.tags.push({
      label: `router-view${ret.meta.matchedRouteSegment ? `: ${ret.meta.matchedRouteSegment}` : ''}`,
      textColor: 0x000000,
      backgroundColor: 0xFF8344,
    })
  }
  return api.visitComponentTree(
    instance,
    ret,
    filter,
    appRecord?.options?.app,
  )
}

/**
 * Mark an instance as captured and store it in the instance map.
 *
 * @param {Vue} instance
 */

function mark(instance) {
  const refId = instance.__VUE_DEVTOOLS_UID__
  if (!instanceMap.has(refId)) {
    instanceMap.set(refId, instance)
    appRecord.instanceMap.set(refId, instance)
    instance.$on('hook:beforeDestroy', () => {
      instanceMap.delete(refId)
    })
    applyPerfHooks(api, instance, appRecord.options.app)
    applyTrackingUpdateHook(api, instance)
  }
}

function markFunctional(id, vnode) {
  const refId = vnode.fnContext.__VUE_DEVTOOLS_UID__
  if (!functionalVnodeMap.has(refId)) {
    functionalVnodeMap.set(refId, {})
    vnode.fnContext.$on('hook:beforeDestroy', () => {
      functionalVnodeMap.delete(refId)
    })
  }

  functionalVnodeMap.get(refId)[id] = vnode

  appRecord.instanceMap.set(id, {
    __VUE_DEVTOOLS_UID__: id,
    __VUE_DEVTOOLS_FUNCTIONAL_LEGACY__: true,
    vnode,
  } as unknown as ComponentInstance)
}
