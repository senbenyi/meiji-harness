// 任务记录迁移：schemaVersion 1（nodes）→ 2（steps）。只改 history/ 下的任务与快照文件，项目内容不变。
// 用法（先停止 Harness）：node meiji/scripts/migrate-task-steps.js <DSH_HOME>
//   nodes → steps；generation → generate，revision → revise；succeeded → completed，interrupted → cancelled；
//   reviewResult → verdict；快照来源 nodeId → stepId；任务状态按步骤重新推导（shared/steps.js）。
// 已是 schemaVersion 2 的记录跳过，可重复执行。迁移前把待迁移项目的 history 目录完整备份到 <DSH_HOME>/backups/task-steps-<时间>/，
// 每个文件写入后读回比对，不一致则还原该项目并中止。未结束的任务保持未结束，由启动时的重启处理统一取消。
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectIds, projectsRoot } from '../server/data/project-files.js'
import { StepStatus, deriveTaskStatus } from '../shared/steps.js'

const TASK_SCHEMA = 2
const kinds = { generation: 'generate', revision: 'revise' }
const statuses = { succeeded: 'completed', interrupted: 'cancelled' }

const renameSource = value => {
  if (!value || typeof value !== 'object' || !('nodeId' in value)) return value
  const { nodeId, ...rest } = value
  return { ...rest, stepId: rest.stepId ?? nodeId ?? null }
}

function convertStep(node, task) {
  const status = statuses[node.status] || node.status
  return {
    id: node.id, kind: kinds[node.kind] || node.kind, target: node.target ?? null, label: node.label ?? null,
    // 已结束任务里仍标为执行中的步骤（旧版本未落定）记为已取消。
    status: task.endedAt && status === StepStatus.RUNNING ? StepStatus.CANCELLED : status,
    verdict: node.reviewResult ?? node.verdict ?? null, reasons: node.reasons || [], error: node.error ?? null,
    actor: node.actor || task.actor || 'model', attempts: node.attempts || [], inputs: node.inputs || [], outputs: node.outputs || [],
    startedAt: node.startedAt ?? null, endedAt: node.endedAt ?? (task.endedAt && status === StepStatus.RUNNING ? task.endedAt : null),
  }
}

export function convertTask(task) {
  const steps = (task.nodes || []).map(node => convertStep(node, task))
  const before = statuses[task.status] || task.status
  // 旧版本在内容校验不通过时只写任务状态与错误：补一个 check 步骤记录不通过结论。
  if (task.endedAt && before === 'review_failed' && deriveTaskStatus(steps) === 'completed') {
    steps.push({ id: `${task.id}-check`, kind: 'check', target: [...steps].reverse().find(step => step.target)?.target || null, label: null, status: StepStatus.COMPLETED,
      verdict: 'fail', reasons: [task.error || '自检未通过'], error: null, actor: 'model', attempts: [], inputs: [], outputs: [], startedAt: task.endedAt, endedAt: task.endedAt })
  }
  const rest = { ...task }
  delete rest.nodes
  return { ...rest, schemaVersion: TASK_SCHEMA, steps, status: deriveTaskStatus(steps),
    artifacts: (task.artifacts || []).map(renameSource), latestOutputs: (task.latestOutputs || []).map(renameSource) }
}

const listJson = async dir => {
  try { return (await readdir(dir)).filter(name => name.endsWith('.json')) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

export async function migrateTaskSteps(home) {
  const pending = []
  for (const id of await projectIds(home)) {
    const history = join(projectsRoot(home), id, 'history')
    const files = []
    for (const name of await listJson(join(history, 'tasks'))) {
      const value = JSON.parse(await readFile(join(history, 'tasks', name), 'utf8'))
      if (value.schemaVersion !== TASK_SCHEMA) files.push({ kind: 'tasks', path: join(history, 'tasks', name), next: convertTask(value), before: value.status })
    }
    for (const name of await listJson(join(history, 'artifacts'))) {
      const value = JSON.parse(await readFile(join(history, 'artifacts', name), 'utf8'))
      if ('nodeId' in value) files.push({ kind: 'artifacts', path: join(history, 'artifacts', name), next: renameSource(value) })
    }
    if (files.length) pending.push({ id, history, files })
  }
  if (!pending.length) return { migrated: 0 }
  const backup = join(home, 'backups', `task-steps-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(backup, { recursive: true })
  for (const { id, history } of pending) await cp(history, join(backup, id), { recursive: true })
  const projects = [], changed = []
  for (const { id, history, files } of pending) {
    try {
      for (const file of files) {
        const text = JSON.stringify(file.next, null, 2)
        await writeFile(file.path, text, { mode: 0o600 })
        if (await readFile(file.path, 'utf8') !== text) throw new Error(`${file.path} 读回内容与写入不一致`)
        if (file.kind === 'tasks' && file.next.endedAt && (statuses[file.before] || file.before) !== file.next.status) changed.push({ projectId: id, taskId: file.next.id, before: file.before, after: file.next.status })
      }
    } catch (error) {
      await cp(join(backup, id), history, { recursive: true, force: true })
      throw new Error(`${id} 迁移失败，已还原该项目的任务记录（备份：${backup}）：${error.message}`)
    }
    projects.push({ id, tasks: files.filter(file => file.kind === 'tasks').length, artifacts: files.filter(file => file.kind === 'artifacts').length })
  }
  return { migrated: projects.length, backup, projects, statusChanged: changed }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-task-steps.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateTaskSteps(resolve(process.argv[2])), null, 2))
}
