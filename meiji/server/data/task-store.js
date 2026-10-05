// 任务、提示词和内容记录的文件读写；projectId 为空时使用创建前草稿目录。
import { deriveTaskStatus } from '../../shared/task-nodes.js'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { notifyProject } from './project-events.js'
import { liveTasks as live, usedSkills } from '../runtime/task-context.js'
import { finalizeNodes } from '../runtime/task-state.js'

export const TASK_SCHEMA = 3
const writes = new Map()
const validId = /^[a-zA-Z0-9_-]+$/
const now = () => new Date().toISOString()
function oldTaskRecordsError(projectId) {
  return Object.assign(new Error(`项目 ${projectId} 的任务记录仍是旧格式，请停止服务后清理旧项目数据`), { code: 'OLD_TASK_RECORDS', status: 409 })
}

export function recordStore(home, projectId) {
  if (projectId != null && !validId.test(projectId)) throw new Error('项目 ID 无效')
  const root = projectId == null ? join(home, 'storages', 'meiji', 'project-drafts', 'history') : join(home, 'storages', 'meiji', 'projects', projectId, 'history')
  const path = (kind, id) => {
    if (!validId.test(id || '')) throw new Error('记录 ID 无效')
    return join(root, kind, id + '.json')
  }
  const read = async (kind, id) => {
    const value = JSON.parse(await readFile(path(kind, id), 'utf8'))
    if (kind === 'tasks' && value.schemaVersion !== TASK_SCHEMA) throw oldTaskRecordsError(projectId)
    return kind === 'tasks' ? { ...value, status: deriveTaskStatus(value.nodes) } : value
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
      for (const kind of ['operations', 'tasks', 'artifacts', 'prompts']) for (const value of await this.list(kind)) {
        if (value.episodeId === episodeId || (kind === 'prompts' && taskIds.has(value.taskId))) await rm(path(kind, value.id), { force: true })
      }
    },
    // 服务重启：遗留的进行中或排队中任务一律取消（执行中的步骤记为已取消）。
    async interrupt() {
      for (const task of await this.list()) {
        if (task.endedAt) continue
        const nodes = structuredClone(task.nodes)
        finalizeNodes(nodes, Object.assign(new Error('服务重启，任务已取消'), { code: 'TASK_CANCELLED' }), { aborted: true })
        await update('tasks', task.id, current => ({ ...current, nodes, status: deriveTaskStatus(nodes), error: '服务重启，任务已取消', endedAt: now() }))
        live.delete(task.id)
      }
      // 遗留的未结束操作同样结束，状态由其任务推导（均已取消）。
      for (const operation of await this.list('operations')) {
        if (operation.endedAt) continue
        await update('operations', operation.id, current => ({ ...current, status: 'cancelled', error: '服务重启，任务已取消', endedAt: now() }))
      }
    },
  }
}

// 按任务写回步骤（一个操作的多个任务共用执行上下文，步骤按目标归入各自任务）；extra 只写入当前步骤所属任务。
export async function writeNodes(context, extra) {
  const primary = await context.store.update('tasks', context.taskId, task => ({ ...task, ...(extra ? extra(task) : {}), ...usedSkills(context), nodes: context.nodes, status: deriveTaskStatus(context.nodes) }))
  live.set(context.taskId, primary)
  notifyProject(context.home, context.projectId)
  return primary
}

export async function readNodePrompts(home, projectId, taskId, nodeId) {
  const store = recordStore(home, projectId)
  const task = await store.read('tasks', taskId)
  if ((task.projectId ?? null) !== projectId) throw Object.assign(new Error('任务不属于当前项目'), { status: 404 })
  const step = task.nodes.find(item => item.id === nodeId)
  if (!step) throw Object.assign(new Error('任务步骤不存在'), { status: 404 })
  return Promise.all((step.prompts || []).map(async ({ id }) => {
    const value = await store.read('prompts', id)
    if (value.taskId !== taskId || value.nodeId !== nodeId) {
      throw Object.assign(new Error('提示词记录不属于当前步骤'), { status: 404 })
    }
    return value
  }))
}
