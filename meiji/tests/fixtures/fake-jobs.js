// 复现公开 registry 契约：run 同步调用，done 异步结算，owner 隔离。
export function fakeJobs({ rejectStart } = {}) {
  let serial = 0
  const rows = new Map()
  const row = (id, caller) => { const value = rows.get(id); if (!value || value.owner && value.owner !== caller) throw Object.assign(new Error('job 不存在或不属于当前会话'), { status: 404 }); return value }
  const view = value => ({ id: value.id, kind: value.kind, owner: value.owner, status: value.status, label: value.label, progress: value.progress })
  return {
    rows,
    start(spec) {
      if (rejectStart?.(spec)) throw new Error('模拟登记失败')
      const id = `${spec.kind}-${++serial}`, value = { ...spec, id, status: 'running', text: '', progress: '' }
      value.hooks = spec.run({ id, append: text => { value.text += text }, updateProgress: text => { value.progress = text } })
      value.done = value.hooks.done.then(outcome => { value.status = outcome.status; value.result = outcome.result; return view(value) })
      rows.set(id, value); return id
    },
    list(caller) { return [...rows.values()].filter(value => !value.owner || value.owner === caller).map(view) },
    get(id, caller) { return view(row(id, caller)) },
    read(id, caller) { const value = row(id, caller), result = value.result; value.result = undefined; return { job: view(value), chunks: [{ text: value.text }], result } },
    kill(id, caller, reason) { const value = row(id, caller); if (value.status !== 'running') return 'already-finished'; value.hooks.cancel(reason); return 'requested' },
    async wait(id, timeout, caller, signal) { const value = row(id, caller); if (value.status !== 'running') return view(value); signal?.throwIfAborted(); return value.done },
    remove(id, caller) { const value = row(id, caller); if (value.status === 'running') throw new Error('尚未结束'); rows.delete(id) },
    async teardown(reason = 'owner disposed') { for (const value of rows.values()) if (value.status === 'running') value.hooks.cancel(reason); await Promise.all([...rows.values()].map(value => value.done)) },
  }
}
