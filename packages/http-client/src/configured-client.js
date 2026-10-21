import { modelClient } from './llm-server/client.js'

/** 按调用方提供的设置与方法用途映射路由；不依赖任何设置存储或业务项目。 */
export function createConfiguredModelClient({ settings, methods, client = modelClient,
  connection = config => ({ baseUrl: config.baseUrl }),
} = {}) {
  if (!settings || typeof settings.read !== 'function') throw new TypeError('需提供settings.read')
  if (!methods || typeof methods !== 'object' || Array.isArray(methods) || !Object.keys(methods).length) throw new TypeError('需提供方法用途映射')
  if (typeof connection !== 'function') throw new TypeError('connection需为函数')
  const routed = Object.create(null)
  for (const [method, purpose] of Object.entries(methods)) {
    if (!Object.hasOwn(client, method) || typeof client[method] !== 'function' || typeof purpose !== 'string' || !purpose)
      throw new TypeError('无效模型调用映射：' + method)
    routed[method] = async (options = {}) => {
      const config = await settings.read(), selection = config[purpose]?.model
      if (typeof selection !== 'string' || !selection) throw new TypeError('缺少模型选择：' + purpose)
      return client[method]({ ...options, ...await connection(config), model: selection })
    }
  }
  return routed
}
