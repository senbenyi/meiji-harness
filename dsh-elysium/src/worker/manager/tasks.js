// 职责：生成、校验并不可变地保存任务原始记录。
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, readdir, rm, writeFile } from '../../database/files.js'
import { join } from 'node:path'
import { tasksRoot } from '../../database/paths.js'
import { ModelTaskError } from '../../utils/errors.js'
import { validJobId, validProjectId } from '../store/paths.js'

const submissionPattern = /^[A-Za-z0-9_-]{8,128}$/
const lanePattern = /^[a-z0-9][a-z0-9:_-]{0,95}$/
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

const stable = value => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
export const requestHash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
export const taskId = (submissionId, index) => createHash('sha256').update(`${submissionId}/${index}`).digest('hex').slice(0, 32)
export const taskFile = id => {
  if (!validJobId(id)) throw invalid('任务 ID 无效')
  return join(tasksRoot(), `${id}.json`)
}

export function validateSubmission({ submission_id: submissionId, lane, project_id: projectId, tasks, channel }) {
  if (!submissionPattern.test(submissionId || '')) throw invalid('submission_id 无效')
  if (!lanePattern.test(lane?.id || '') || !['interactive', 'batch'].includes(lane?.priority)) throw invalid('泳道配置无效')
  if (!validProjectId(projectId)) throw invalid('project_id 必须为时间项目 ID 或兼容的 8 位项目 ID')
  if (!Array.isArray(tasks) || !tasks.length) throw invalid('至少提交一个任务')
  if (channel !== undefined && (typeof channel !== 'string' || !channel || channel.length > 64)) throw invalid('channel 无效')
  for (const [index, task] of tasks.entries()) {
    if (!task || !['image', 'video'].includes(task.kind) || !task.plan || typeof task.plan !== 'object' || Array.isArray(task.plan)) throw invalid(`第 ${index + 1} 个任务无效`)
    if (task.binding !== undefined && Buffer.byteLength(JSON.stringify(task.binding)) > 2048) throw invalid(`第 ${index + 1} 个任务的 binding 超过 2 KB`)
  }
}

export function jobReferences(value, found = new Set()) {
  if (typeof value === 'string') {
    const match = /^job:([a-f0-9]{32})$/.exec(value)
    if (match) found.add(match[1])
  } else if (Array.isArray(value)) for (const item of value) jobReferences(item, found)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) jobReferences(item, found)
  return [...found]
}

export async function writeTask(task) {
  await mkdir(tasksRoot(), { recursive: true })
  const temporary = join(tasksRoot(), `.${task.task_id}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(task, null, 2), { flag: 'wx', mode: 0o600 })
    await link(temporary, taskFile(task.task_id))
    return task
  } finally { await rm(temporary, { force: true }) }
}

export const readTask = id => readFile(taskFile(id), 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null
  throw error
})

export async function listTasks() {
  const entries = await readdir(tasksRoot(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const tasks = []
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{32}\.json$/.test(entry.name)) continue
    try { tasks.push(JSON.parse(await readFile(join(tasksRoot(), entry.name), 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return tasks
}
