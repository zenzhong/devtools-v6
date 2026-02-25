import { SharedData, classify, kebabize } from '@vue-devtools/shared-utils'
import { getInstanceName } from './util'

const SEARCH_MAX_DEPTH = 50

/**
 * 解包 Vue 3 响应式对象：Proxy -> raw, Ref -> value
 */
function unwrapValue(value: any): any {
  // 解包 reactive/readonly Proxy
  if (value?.__v_raw) {
    value = value.__v_raw
  }
  // 解包 Ref
  if (value?.__v_isRef) {
    value = value.value
    // ref.value 也可能是 reactive proxy
    if (value?.__v_raw) {
      value = value.__v_raw
    }
  }
  return value
}

/**
 * 检测是否为 Vue 3 组件实例（内部实例或 proxy）
 */
function isVueInstance(obj: any): boolean {
  // Vue 3 组件内部实例：有 vnode + setupState + type
  if (obj.vnode && obj.setupState !== undefined && obj.type) {
    return true
  }
  // Vue 3 组件 proxy：有 $ 属性指向内部实例
  if (obj.$ && obj.$.vnode) {
    return true
  }
  // VNode 对象
  if (obj.__v_isVNode) {
    return true
  }
  return false
}

/**
 * 在 Vue 3 响应式数据中递归搜索，能穿透 Proxy/Ref
 * 返回匹配到的路径字符串（如 'state.currentAudit.verify_flag'），未匹配返回 null
 */
function searchInReactiveObject(obj: any, searchTerm: string, seen: Set<any> = new Set(), depth = 0): string | null {
  if (depth > SEARCH_MAX_DEPTH || obj == null) {
    return null
  }

  obj = unwrapValue(obj)

  if (obj == null || typeof obj !== 'object') {
    return String(obj).toLowerCase().includes(searchTerm) ? '' : null
  }

  if (seen.has(obj)) {
    return null
  }
  seen.add(obj)

  // 跳过 Vue 组件实例，避免穿透到子组件数据
  if (isVueInstance(obj)) {
    return null
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const subPath = searchInReactiveObject(obj[i], searchTerm, seen, depth + 1)
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
    // 跳过 Vue 内部属性
    if (key.startsWith('__v_') || key === 'dep' || key === 'effect') {
      continue
    }
    // 匹配 key
    if (key.toLowerCase().includes(searchTerm)) {
      return key
    }
    // 递归匹配 value
    try {
      const subPath = searchInReactiveObject(obj[key], searchTerm, seen, depth + 1)
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

/**
 * 检测值是否包含 Vue 实例（直接是实例或数组元素全是实例）
 */
function containsVueInstances(val: any): boolean {
  if (val == null || typeof val !== 'object') {
    return false
  }
  const unwrapped = unwrapValue(val)
  if (unwrapped != null && typeof unwrapped === 'object' && isVueInstance(unwrapped)) {
    return true
  }
  if (Array.isArray(unwrapped) && unwrapped.length > 0 && unwrapped.every((item) => {
    const u = unwrapValue(item)
    return u != null && typeof u === 'object' && isVueInstance(u)
  })) {
    return true
  }
  return false
}

export interface MatchResult {
  matched: boolean
  // 匹配来源：name=组件名, props/data/setupState/computed=数据字段
  matchSource?: string
  // 匹配的顶层字段名列表
  matchedFields?: string[]
}

export class ComponentFilter {
  filter: string

  constructor(filter: string) {
    this.filter = filter || ''
  }

  /**
   * Check if an instance is qualified.
   *
   * @param {Vue|Vnode} instance
   * @return {boolean}
   */
  isQualified(instance) {
    return this.getMatchResult(instance).matched
  }

  /**
   * Get detailed match result for an instance.
   */
  getMatchResult(instance): MatchResult {
    const name = getInstanceName(instance)
    // 先匹配组件名称
    if (
      classify(name).toLowerCase().includes(this.filter)
      || kebabize(name).toLowerCase().includes(this.filter)
    ) {
      return { matched: true, matchSource: 'name' }
    }

    // 名称不匹配时，根据开关决定是否搜索组件数据
    if (SharedData.searchComponentData) {
      return this.matchComponentData(instance)
    }
    return { matched: false }
  }

  /**
   * Search component props, data, setupState, and computed for the filter term.
   */
  private matchComponentData(instance): MatchResult {
    const matchedFields: string[] = []
    try {
      const { props, data, setupState } = instance
      if (props) {
        for (const key of Object.keys(props)) {
          try {
            const val = props[key]
            if (containsVueInstances(val)) {
              continue
            }
            if (key.toLowerCase().includes(this.filter)) {
              matchedFields.push(`$props.${key}`)
            }
            else {
              const subPath = searchInReactiveObject(val, this.filter)
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
            if (key.toLowerCase().includes(this.filter)) {
              matchedFields.push(`$data.${key}`)
            }
            else {
              const subPath = searchInReactiveObject(val, this.filter)
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
          if (key.startsWith('__v_') || key === 'dep' || key === 'effect') {
            continue
          }
          try {
            const val = setupState[key]
            if (containsVueInstances(val)) {
              continue
            }
            if (key.toLowerCase().includes(this.filter)) {
              matchedFields.push(`$setup.${key}`)
            }
            else {
              const subPath = searchInReactiveObject(val, this.filter)
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
      // 搜索 Options API computed 属性的值
      const computedDefs = instance.type && instance.type.computed
      if (computedDefs) {
        for (const key in computedDefs) {
          if (key.toLowerCase().includes(this.filter)) {
            matchedFields.push(`$computed.${key}`)
            continue
          }
          try {
            const val = instance.proxy && instance.proxy[key]
            if (val != null) {
              const subPath = searchInReactiveObject(val, this.filter)
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
      // 安全访问：某些 getter 可能抛出异常，静默忽略
    }
    if (matchedFields.length > 0) {
      return { matched: true, matchSource: 'data', matchedFields }
    }
    return { matched: false }
  }
}
