// 任务、提示词和内容记录的文件读写；任务执行位于 runtime/task-execution.js。
import { deriveTaskStatus } from '../../shared/task-steps.js'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { notifyProject } from './project-events.js'
import { liveTasks as live, usedSkills } from '../runtime/task-context.js'
import { finalizeSteps } from '../runtime/task-state.js'

export const TASK_SCHEMA = 2
const writes = new Map()
const validId = /^[a-zA-Z0-9_-]+$/
const now = () => new Date().toISOString()
function oldTaskRecordsError(projectId) {
  return Object.assign(new Error(`项目 ${projectId} 的任务记录仍是旧格式，请停止服务后执行：node meiji/scripts/migrate-task-steps.js <DSH_HOME>`), { code: 'OLD_TASK_RECORDS', status: 409 })
}

export function recordStore(home, projectId) {
  if (!validId.test(projectId || '')) throw new Error('项目 ID 无效')
  const root = join(home, 'storages', 'meiji', 'projects', projectId, 'history')
  const path = (kind, id) => {
    if (!validId.test(id || '')) throw new Error('记录 ID 无效')
    return join(root, kind, id + '.json')
  }
  const read = async (kind, id) => {
    const value = JSON.parse(await readFile(path(kind, id), 'utf8'))
    if (kind === 'tasks' && value.schemaVersion !== TASK_SCHEMA) throw oldTaskRecordsError(projectId)
    return value
  }
  const update = async (kind, id, change) => {
    const file = path(kind, id)
    const job = (writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      let current = null
      try { current = JSON.parse(await readFile(file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      const next = typeof change === 'function' ? change(current) : change
      await mkdir(join(root, kind), { recursive: true })
      const temp = file + '.' + randomUUID() + '.tmp'
      try { await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 }); await rename(temp, file) }
      finally { await rm(temp, { force: true }) }
      return next
    })
    writes.set(file, job)
    try { return await job } finally { if (writes.get(file) === job) writes.delete(file) }
  }
  return {
    read, update,
    async list(kind = 'tasks') {
      let names
      try { names = await readdir(join(root, kind)) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      return Promise.all(names.filter(name => name.endsWith('.json')).map(name => read(kind, name.slice(0, -5))))
    },
    async removeEpisode(episodeId) {
      const taskIds = new Set((await this.list('tasks')).filter(task => task.episodeId === episodeId).map(task => task.id))
      for (const kind of ['tasks', 'artifacts', 'prompts']) for (const value of await this.list(kind)) {
        if (value.episodeId === episodeId || (kind === 'prompts' && taskIds.has(value.taskId))) await rm(path(kind, value.id), { force: true })
      }
    },
    // 服务重启：遗留的进行中或排队中任务一律取消（执行中的步骤记为已取消）。
    async interrupt() {
      for (const task of await this.list()) {
        if (task.endedAt) continue
        const steps = structuredClone(task.steps)
        finalizeSteps(steps, Object.assign(new Error('服务重启，任务已取消'), { code: 'TASK_CANCELLED' }), { aborted: true })
        await update('tasks', task.id, current => ({ ...current, steps, status: deriveTaskStatus(steps), error: '服务重启，任务已取消', endedAt: now() }))
        live.delete(task.id)
      }
    },
  }
}

export async function writeSteps(context, extra) {
  const record = await context.store.update('tasks', context.taskId, task => ({ ...task, ...(extra ? extra(task) : {}), ...usedSkills(context), steps: context.steps, status: deriveTaskStatus(context.steps) }))
  live.set(context.taskId, record)
  notifyProject(context.home, context.projectId)
  return record
}

export async function readStepPrompts(home, projectId, taskId, stepId) {
  const store = recordStore(home, projectId)
  const task = await store.read('tasks', taskId)
  if (task.projectId !== projectId) throw Object.assign(new Error('任务不属于当前项目'), { status: 404 })
  const step = task.steps.find(item => item.id === stepId)
  if (!step) throw Object.assign(new Error('任务步骤不存在'), { status: 404 })
  return Promise.all((step.prompts || []).map(async ({ id }) => {
    const value = await store.read('prompts', id)
    if (value.taskId !== taskId || value.stepId !== stepId) {
      throw Object.assign(new Error('提示词记录不属于当前步骤'), { status: 404 })
    }
    return value
  }))
}
