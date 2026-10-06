// 任务（Run）与步骤快照的存储；所有进程内写入按项目串行。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RUN_SCHEMA, StepStatus, deriveRunStatus, isRunEnded, validateRun } from '../../shared/run-model.js'

const writes = new Map()
const validId = /^[a-zA-Z0-9_-]{1,128}$/
const now = () => new Date().toISOString()
const requireId = id => { if (typeof id !== 'string' || !validId.test(id)) throw Object.assign(new Error('记录 ID 无效'), { status: 422 }); return id }
const missing = () => Object.assign(new Error('任务或步骤不存在'), { status: 404 })

export function runStore(home, projectId) {
  requireId(projectId)
  const root = join(resolve(home), 'storages', 'meiji', 'projects', projectId, 'history')
  const path = (kind, id) => join(root, kind, requireId(id) + '.json')
  const serial = async job => {
    const pending = (writes.get(root) || Promise.resolve()).catch(() => {}).then(job)
    writes.set(root, pending)
    try { return await pending } finally { if (writes.get(root) === pending) writes.delete(root) }
  }
  const read = async id => {
    let run
    try { run = JSON.parse(await readFile(path('runs', id), 'utf8')) } catch (error) { if (error.code === 'ENOENT') throw missing(); throw error }
    validateRun(run)
    if (run.id !== id || run.projectId !== projectId) throw missing()
    return { ...run, status: deriveRunStatus(run) }
  }
  const list = async () => {
    let names
    try { names = await readdir(join(root, 'runs')) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    return Promise.all(names.filter(name => name.endsWith('.json')).map(name => read(name.slice(0, -5))))
  }
  const write = async (kind, id, value) => {
    const file = path(kind, id), temp = file + '.' + randomUUID() + '.tmp'
    await mkdir(join(root, kind), { recursive: true })
    try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temp, file) }
    finally { await rm(temp, { force: true }) }
    return value
  }
  const commit = async run => {
    validateRun(run)
    if (run.projectId !== projectId) throw missing()
    const status = deriveRunStatus(run)
    if (status === 'completed' && !run.events.some(event => event.type === 'completed')) run.events.push({ at: now(), type: 'completed', actor: 'engine' })
    return write('runs', run.id, { ...run, status, endedAt: ['completed', 'cancelled'].includes(status) ? run.endedAt || now() : null, revision: (run.revision || 0) + 1 })
  }
  const openRun = async episodeId => (await list()).find(run => run.episodeId === episodeId && !isRunEnded(run)) || null
  return {
    read, list, openRun,
    create(run) {
      const snapshot = structuredClone(run)
      return serial(async () => {
        if (snapshot.schemaVersion !== RUN_SCHEMA) throw new Error('任务版本无效')
        const open = await openRun(snapshot.episodeId)
        if (open) throw Object.assign(new Error('请并入当前任务'), { code: 'RUN_AMEND_REQUIRED', status: 409, runId: open.id })
        try { await read(snapshot.id); throw Object.assign(new Error('任务 ID 已存在'), { status: 409 }) } catch (error) { if (error.status !== 404) throw error }
        return commit(snapshot)
      })
    },
    update(id, change) {
      return serial(async () => {
        const run = await read(id), next = await change(run)
        if (next.id !== id || next.projectId !== run.projectId || next.episodeId !== run.episodeId) throw new Error('不能修改任务归属')
        return commit(next)
      })
    },
    // 快照和引用在同一个串行区间提交；断电留下的无引用快照不进入步骤详情。
    record(id, stepId, kind, data) {
      if (!['prompts', 'responses', 'artifacts'].includes(kind)) throw new Error('快照类型无效')
      const snapshot = structuredClone(data)
      return serial(async () => {
        const run = await read(id), step = run.steps.find(item => item.id === stepId)
        if (!step) throw missing()
        const record = { ...snapshot, id: snapshot.id || randomUUID(), runId: id, stepId, projectId, createdAt: snapshot.createdAt || now() }
        requireId(record.id)
        try { await readFile(path('run-' + kind, record.id)); throw new Error('快照 ID 已存在') } catch (error) { if (error.code !== 'ENOENT') throw error }
        await write('run-' + kind, record.id, record)
        step[kind] ||= []; step[kind].push(record.id)
        await commit(run)
        return record
      })
    },
    async records(id, stepId, kind) {
      if (!['prompts', 'responses', 'artifacts'].includes(kind)) throw new Error('快照类型无效')
      const run = await read(id), step = run.steps.find(item => item.id === stepId)
      if (!step) throw missing()
      return Promise.all((step[kind] || []).map(async recordId => {
        const record = JSON.parse(await readFile(path('run-' + kind, recordId), 'utf8'))
        if (record.id !== recordId || record.projectId !== projectId || record.runId !== id || record.stepId !== stepId) throw missing()
        return record
      }))
    },
    updateRecord(id, stepId, kind, recordId, change) {
      if (!['prompts', 'responses', 'artifacts'].includes(kind)) throw new Error('快照类型无效')
      return serial(async () => {
        const run = await read(id), step = run.steps.find(item => item.id === stepId)
        if (!step?.[kind]?.includes(recordId)) throw missing()
        const record = JSON.parse(await readFile(path('run-' + kind, recordId), 'utf8'))
        if (record.runId !== id || record.stepId !== stepId || record.projectId !== projectId) throw missing()
        const next = await change(record)
        if (next.id !== recordId || next.runId !== id || next.stepId !== stepId || next.projectId !== projectId) throw missing()
        return write('run-' + kind, recordId, next)
      })
    },
    async listRecords(kind) {
      if (!['prompts', 'responses', 'artifacts'].includes(kind)) throw new Error('快照类型无效')
      let names
      try { names = await readdir(join(root, 'run-' + kind)) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      return Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
        const record = JSON.parse(await readFile(path('run-' + kind, name.slice(0, -5)), 'utf8'))
        if (record.projectId !== projectId) throw missing()
        return record
      }))
    },
    async readRecord(kind, recordId) {
      if (!['prompts', 'responses', 'artifacts'].includes(kind)) throw new Error('快照类型无效')
      let record
      try { record = JSON.parse(await readFile(path('run-' + kind, recordId), 'utf8')) } catch (error) { if (error.code === 'ENOENT') throw missing(); throw error }
      if (record.id !== recordId || record.projectId !== projectId) throw missing()
      const run = await read(record.runId), step = run.steps.find(item => item.id === record.stepId)
      if (!step?.[kind]?.includes(recordId)) throw missing()
      return record
    },
    // 删除剧集：连同该集的任务及其提示词、原始返回、内容快照一并删除；项目级任务保留。
    removeEpisode(episodeId) {
      return serial(async () => {
        const runIds = new Set((await list()).filter(run => run.episodeId === episodeId).map(run => run.id))
        for (const kind of ['prompts', 'responses', 'artifacts']) {
          let names
          try { names = await readdir(join(root, 'run-' + kind)) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
          for (const name of names.filter(item => item.endsWith('.json'))) {
            const file = join(root, 'run-' + kind, name), record = JSON.parse(await readFile(file, 'utf8'))
            if (runIds.has(record.runId) || record.episodeId === episodeId) await rm(file, { force: true })
          }
        }
        for (const id of runIds) await rm(path('runs', id), { force: true })
        return [...runIds]
      })
    },
    async interrupt() {
      // 必须在无执行器运行的启动恢复阶段调用。
      return serial(async () => {
        const interrupted = []
        for (const run of await list()) {
          if (isRunEnded(run)) continue
          const steps = run.steps.filter(step => step.status === 'running')
          if (!steps.length) continue
          run.pause ||= { reasons: [] }
          for (const step of steps) {
            step.status = StepStatus.PAUSED; step.error = '服务重启，步骤执行中断'; step.endedAt = now()
            run.pause.reasons.push({ code: 'interrupted', stepId: step.id, target: step.target, message: step.error, actions: ['retry'] })
          }
          run.events.push({ at: now(), type: 'paused', actor: 'engine', stepIds: steps.map(step => step.id), payload: { code: 'interrupted' } })
          interrupted.push(await commit(run))
        }
        return interrupted
      })
    },
  }
}

// 内容发布仍是“先快照、后项目提交、再 published”，但身份与文件归 Run/Step。
export function runRecordStore(home, projectId, runId, stepId) {
  const store = runStore(home, projectId)
  return {
    updateStep(patch) { return store.update(runId, current => { const step = current.steps.find(item => item.id === stepId); if (!step) throw missing(); Object.assign(step, structuredClone(patch)); return current }) },
    update(kind, id, change) {
      return typeof change === 'function' ? store.updateRecord(runId, stepId, kind, id, change) : store.record(runId, stepId, kind, { ...change, id })
    },
    async read(kind, id) {
      const record = (await store.records(runId, stepId, kind)).find(item => item.id === id)
      if (!record) throw missing()
      return record
    },
    list: kind => store.listRecords(kind),
  }
}
