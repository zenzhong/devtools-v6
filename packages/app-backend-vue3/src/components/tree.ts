import type { BackendContext, DevtoolsApi } from '@vue-devtools/app-backend-api'
import type { ComponentTreeNode } from '@vue/devtools-api'
import { getInstanceName, getRenderKey, getUniqueComponentId, isBeingDestroyed, isFragment } from './util'
import { ComponentFilter } from './filter'
import { getRootElementsFromComponentInstance } from './el'

export class ComponentWalker {
  ctx: BackendContext
  api: DevtoolsApi
  maxDepth: number
  recursively: boolean
  componentFilter: ComponentFilter
  // Dedupe instances
  // Some instances may be both on a component and on a child abstract/functional component
  captureIds: Map<string, undefined>

  constructor(maxDepth: number, filter: string, recursively: boolean, api: DevtoolsApi, ctx: BackendContext) {
    this.ctx = ctx
    this.api = api
    this.maxDepth = maxDepth
    this.recursively = recursively
    this.componentFilter = new ComponentFilter(filter)
  }

  getComponentTree(instance: any): Promise<ComponentTreeNode[]> {
    this.captureIds = new Map()
    return this.findQualifiedChildren(instance, 0)
  }

  getComponentParents(instance: any) {
    this.captureIds = new Map()
    const parents = []
    this.captureId(instance)
    let parent = instance
    // eslint-disable-next-line no-cond-assign
    while ((parent = parent.parent)) {
      this.captureId(parent)
      parents.push(parent)
    }
    return parents
  }

  /**
   * Find qualified children from a single instance.
   * If the instance itself is qualified, just return itself.
   * This is ok because [].concat works in both cases.
   *
   * @param {Vue|Vnode} instance
   * @return {Vue|Array}
   */
  private async findQualifiedChildren(instance: any, depth: number): Promise<ComponentTreeNode[]> {
    const matchResult = this.componentFilter.getMatchResult(instance)
    if (matchResult.matched && !instance.type.devtools?.hide) {
      const node = await this.capture(instance, null, depth)
      // 给直接匹配的节点添加 matched tag
      if (this.componentFilter.filter) {
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
        this.markMatchedChildren(node)
      }
      return [node]
    }
    else if (instance.subTree) {
      // TODO functional components
      const list = this.isKeepAlive(instance)
        ? this.getKeepAliveCachedInstances(instance)
        : this.getInternalInstanceChildren(instance.subTree)
      return this.findQualifiedChildrenFromList(list, depth)
    }
    else {
      return []
    }
  }

  /**
   * 递归遍历已 capture 的子树节点，对匹配搜索词的子组件打 tag
   */
  private markMatchedChildren(node: ComponentTreeNode): void {
    if (!node.children || !node.children.length) {
      return
    }
    for (const child of node.children) {
      const instance = this.ctx.currentAppRecord.instanceMap.get(child.id)
      if (instance) {
        const childMatch = this.componentFilter.getMatchResult(instance)
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
      this.markMatchedChildren(child)
    }
  }

  /**
   * Iterate through an array of instances and flatten it into
   * an array of qualified instances. This is a depth-first
   * traversal - e.g. if an instance is not matched, we will
   * recursively go deeper until a qualified child is found.
   *
   * @param {Array} instances
   * @return {Array}
   */
  private async findQualifiedChildrenFromList(instances, depth: number): Promise<ComponentTreeNode[]> {
    instances = instances
      .filter(child => !isBeingDestroyed(child) && !child.type.devtools?.hide)
    if (!this.componentFilter.filter) {
      return Promise.all(instances.map((child, index, list) => this.capture(child, list, depth)))
    }
    else {
      return Array.prototype.concat.apply([], await Promise.all(instances.map(i => this.findQualifiedChildren(i, depth))))
    }
  }

  /**
   * Get children from a component instance.
   */
  private getInternalInstanceChildren(subTree, suspense = null) {
    const list = []
    if (subTree) {
      if (subTree.component) {
        !suspense ? list.push(subTree.component) : list.push({ ...subTree.component, suspense })
      }
      else if (subTree.suspense) {
        const suspenseKey = !subTree.suspense.isInFallback ? 'suspense default' : 'suspense fallback'
        list.push(...this.getInternalInstanceChildren(subTree.suspense.activeBranch, { ...subTree.suspense, suspenseKey }))
      }
      else if (Array.isArray(subTree.children)) {
        subTree.children.forEach((childSubTree) => {
          if (childSubTree.component) {
            !suspense ? list.push(childSubTree.component) : list.push({ ...childSubTree.component, suspense })
          }
          else {
            list.push(...this.getInternalInstanceChildren(childSubTree, suspense))
          }
        })
      }
    }
    return list.filter(child => !isBeingDestroyed(child) && !child.type.devtools?.hide)
  }

  private captureId(instance): string {
    if (!instance) {
      return null
    }

    // instance.uid is not reliable in devtools as there
    // may be 2 roots with same uid which causes unexpected
    // behaviour
    const id = instance.__VUE_DEVTOOLS_UID__ != null ? instance.__VUE_DEVTOOLS_UID__ : getUniqueComponentId(instance, this.ctx)
    instance.__VUE_DEVTOOLS_UID__ = id

    // Dedupe
    if (this.captureIds.has(id)) {
      return
    }
    else {
      this.captureIds.set(id, undefined)
    }

    this.mark(instance)

    return id
  }

  /**
   * Capture the meta information of an instance. (recursive)
   *
   * @param {Vue} instance
   * @return {object}
   */
  private async capture(instance: any, list: any[], depth: number): Promise<ComponentTreeNode> {
    if (!instance) {
      return null
    }

    const id = this.captureId(instance)

    const name = getInstanceName(instance)

    const children = this.getInternalInstanceChildren(instance.subTree)
      .filter(child => !isBeingDestroyed(child))

    const parents = this.getComponentParents(instance) || []

    const inactive = !!instance.isDeactivated || parents.some(parent => parent.isDeactivated)

    const treeNode: ComponentTreeNode = {
      uid: instance.uid,
      id,
      name,
      renderKey: getRenderKey(instance.vnode ? instance.vnode.key : null),
      inactive,
      hasChildren: !!children.length,
      children: [],
      isFragment: isFragment(instance),
      tags: typeof instance.type !== 'function'
        ? []
        : [
            {
              label: 'functional',
              textColor: 0x555555,
              backgroundColor: 0xEEEEEE,
            },
          ],
      autoOpen: this.recursively,
    }

    // capture children
    if (depth < this.maxDepth || instance.type.__isKeepAlive || parents.some(parent => parent.type.__isKeepAlive)) {
      treeNode.children = await Promise.all(children
        .map((child, index, list) => this.capture(child, list, depth + 1))
        .filter(Boolean))
    }

    // keep-alive
    if (this.isKeepAlive(instance)) {
      const cachedComponents = this.getKeepAliveCachedInstances(instance)
      const childrenIds = children.map(child => child.__VUE_DEVTOOLS_UID__)
      for (const cachedChild of cachedComponents) {
        if (!childrenIds.includes(cachedChild.__VUE_DEVTOOLS_UID__)) {
          const node = await this.capture({ ...cachedChild, isDeactivated: true }, null, depth + 1)
          if (node) {
            treeNode.children.push(node)
          }
        }
      }
    }

    // ensure correct ordering
    const rootElements = getRootElementsFromComponentInstance(instance)
    const firstElement = rootElements[0]
    if (firstElement?.parentElement) {
      const parentInstance = instance.parent
      const parentRootElements = parentInstance ? getRootElementsFromComponentInstance(parentInstance) : []
      let el = firstElement
      const indexList = []
      do {
        indexList.push(Array.from(el.parentElement.childNodes).indexOf(el))
        el = el.parentElement
      } while (el.parentElement && parentRootElements.length && !parentRootElements.includes(el))
      treeNode.domOrder = indexList.reverse()
    }
    else {
      treeNode.domOrder = [-1]
    }

    if (instance.suspense?.suspenseKey) {
      treeNode.tags.push({
        label: instance.suspense.suspenseKey,
        backgroundColor: 0xE492E4,
        textColor: 0xFFFFFF,
      })
      // update instanceMap
      this.mark(instance, true)
    }

    return this.api.visitComponentTree(instance, treeNode, this.componentFilter.filter, this.ctx.currentAppRecord.options.app)
  }

  /**
   * Mark an instance as captured and store it in the instance map.
   *
   * @param {Vue} instance
   */
  private mark(instance, force = false) {
    const instanceMap = this.ctx.currentAppRecord.instanceMap
    if (force || !instanceMap.has(instance.__VUE_DEVTOOLS_UID__)) {
      instanceMap.set(instance.__VUE_DEVTOOLS_UID__, instance)
    }
  }

  private isKeepAlive(instance) {
    return instance.type.__isKeepAlive && instance.__v_cache
  }

  private getKeepAliveCachedInstances(instance) {
    return Array.from(instance.__v_cache.values()).map((vnode: any) => vnode.component).filter(Boolean)
  }
}
