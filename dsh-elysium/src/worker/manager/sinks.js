// 职责：维护不解析 binding 内容的结算回写处理器注册表。
const sinks = new Map()

export function registerSink(type, handler) {
  if (typeof type !== 'string' || !type || typeof handler !== 'function') throw new Error('回写处理器无效')
  const previous = sinks.get(type)
  sinks.set(type, handler)
  return () => { if (sinks.get(type) === handler) previous ? sinks.set(type, previous) : sinks.delete(type) }
}

export const sinkFor = type => sinks.get(type)
