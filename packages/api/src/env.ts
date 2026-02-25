import type { ApiProxy } from './proxy.js'
import type { PluginDescriptor, SetupFunction } from './index.js'

export interface PluginQueueItem {
  pluginDescriptor: PluginDescriptor
  setupFn: SetupFunction
  proxy?: ApiProxy
}

interface GlobalTarget {
  __VUE_DEVTOOLS_PLUGINS__?: PluginQueueItem[]
  __VUE_DEVTOOLS_PLUGIN_API_AVAILABLE__?: boolean
}

export function getDevtoolsGlobalHook(): any {
  return (getTarget() as any).__VUE_DEVTOOLS_GLOBAL_HOOK__
}

export function getTarget(): GlobalTarget {
  return (typeof navigator !== 'undefined' && typeof window !== 'undefined')
    ? window as GlobalTarget & Window
    : typeof globalThis !== 'undefined'
      ? globalThis as GlobalTarget & typeof globalThis
      : {} as GlobalTarget
}

export const isProxyAvailable = typeof Proxy === 'function'
