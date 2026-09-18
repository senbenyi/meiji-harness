// 职责：沿异步调用链传递当前插件实例的运行配置。
import { AsyncLocalStorage } from 'node:async_hooks'

const context = new AsyncLocalStorage()

export const runtimeConfig = () => context.getStore() || process.env
export const withConfig = (config, callback) => context.run(config, callback)
