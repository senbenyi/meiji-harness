// 全局任务队列：按类别（text / image / video）限制同时运行的任务数，超出的任务排队。
// 空出名额时直接交给排在最前的任务（不重新竞争），排队期间可取消。
// 服务重启一律取消进行中任务，队列只在内存中。
export const defaultConcurrency = Object.freeze({ text: 4, image: 2, video: 2 })

const videoActions = new Set(['film', 'films', 'produce', 'produce-all', 'tail-frame'])
const imageActions = new Set(['image', 'revise-image', 'part-image', 'pencil'])
export const taskKind = action => videoActions.has(action) ? 'video' : imageActions.has(action) ? 'image' : 'text'

export function createQueue(limitOf = kind => defaultConcurrency[kind]) {
  const active = new Map(), waiting = new Map()
  const release = kind => {
    const next = waiting.get(kind)?.shift()
    if (next) next()
    else active.set(kind, active.get(kind) - 1)
  }
  const waitTurn = (kind, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const list = waiting.get(kind) ?? []
    waiting.set(kind, list)
    const onAbort = () => {
      const index = list.indexOf(turn)
      if (index >= 0) list.splice(index, 1)
      reject(signal.reason)
    }
    const turn = () => { signal?.removeEventListener('abort', onAbort); resolve() }
    list.push(turn)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  return {
    async run(kind, signal, job, onQueued) {
      signal?.throwIfAborted()
      const limit = Math.max(1, Math.floor(Number(await limitOf(kind))) || 1)
      signal?.throwIfAborted() // 读取上限期间可能已被取消
      // 读取上限之后同步判断并占用名额，避免并发调用同时通过。
      if ((active.get(kind) || 0) < limit) active.set(kind, (active.get(kind) || 0) + 1)
      else { onQueued?.(); await waitTurn(kind, signal) }
      try { return await job() } finally { release(kind) }
    },
    stats: () => Object.fromEntries(['text', 'image', 'video'].map(kind => [kind, { active: active.get(kind) || 0, waiting: waiting.get(kind)?.length || 0 }])),
  }
}
