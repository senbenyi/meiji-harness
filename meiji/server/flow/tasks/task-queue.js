// 全局模型队列：按类别（text / image / video）限制同时运行的步骤数，超出的排队。
// 空出名额时直接交给排在最前的步骤（不重新竞争），排队期间可取消。队列只在内存中。
export const defaultConcurrency = Object.freeze({ text: 4, image: 2, video: 2 })

export function createQueue(limitOf = kind => defaultConcurrency[kind]) {
  const active = new Map(), waiting = new Map()
  const release = kind => {
    const next = waiting.get(kind)?.shift()
    if (next) next()
    else active.set(kind, active.get(kind) - 1)
  }
  const waitTurn = (kind, signal, id) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const list = waiting.get(kind) ?? []
    waiting.set(kind, list)
    const onAbort = () => {
      const index = list.indexOf(turn)
      if (index >= 0) list.splice(index, 1)
      reject(signal.reason)
    }
    const turn = () => { signal?.removeEventListener('abort', onAbort); resolve() }
    turn.id = id
    list.push(turn)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  return {
    // id 可选，用于查询排队位置。
    async run(kind, signal, job, onQueued, id) {
      signal?.throwIfAborted()
      const limit = Math.max(1, Math.floor(Number(await limitOf(kind))) || 1)
      signal?.throwIfAborted() // 读取上限期间可能已被取消
      // 读取上限之后同步判断并占用名额，避免并发调用同时通过。
      if ((active.get(kind) || 0) < limit) active.set(kind, (active.get(kind) || 0) + 1)
      else { onQueued?.(); await waitTurn(kind, signal, id) }
      try { return await job() } finally { release(kind) }
    },
    // 排队位置（从 1 开始）；不在队列中为 null。
    position(id) {
      for (const list of waiting.values()) {
        const index = list.findIndex(turn => turn.id === id)
        if (index >= 0) return index + 1
      }
      return null
    },
    stats: () => Object.fromEntries(['text', 'image', 'video'].map(kind => [kind, { active: active.get(kind) || 0, waiting: waiting.get(kind)?.length || 0 }])),
  }
}
