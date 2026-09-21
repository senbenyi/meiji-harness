// 职责：持续对账任务、观察执行状态、串行结算并在全局单并发约束下派发下一个任务。
import { access } from '../../database/files.js'
import { join } from 'node:path'
import { readJson } from '../../database/json.js'
import { dispatch, setDriverWake, settle } from '../manager/manager.js'
import { loadDriver, saveDriver, selectNext, withQueueLock } from '../manager/queue.js'
import { jobReferences, listTasks } from '../manager/tasks.js'
import { routeTask } from '../routing/route.js'
import { getJob } from '../runner/inspect.js'
import { createFailedJob, createJob } from '../store/records.js'
import { jobRoot } from '../store/paths.js'
import { terminalStatus } from '../store/status.js'
import { CAPABILITIES } from '../manager/policy.js'

const ACTIVE_INTERVAL = 2_000
const IDLE_INTERVAL = 15_000
const FULL_RECONCILE_INTERVAL = 10 * 60_000

async function reconcile(full) {
  return withQueueLock(async () => {
    const driver = await loadDriver()
    const indexed = new Set(driver.entries.map(entry => entry.task_id))
    if (full) for (const task of await listTasks()) {
      try { await access(jobRoot(task.task_id)) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        try {
          const routed = await routeTask(task.kind, task.plan, { deferReferences: jobReferences(task.plan) })
          await createJob(task.project_id, routed.plan, routed.backend, { id: task.task_id, capability: CAPABILITIES[task.kind],
            origin: { task_id: task.task_id, submission_id: task.submission_id, lane_id: task.lane.id, seq: task.seq, binding: task.binding, project_id: task.project_id } })
        } catch (routeError) {
          await createFailedJob(task.project_id, task.plan, { id: task.task_id, capability: CAPABILITIES[task.kind], error: routeError,
            origin: { task_id: task.task_id, submission_id: task.submission_id, lane_id: task.lane.id, seq: task.seq, binding: task.binding, project_id: task.project_id } })
        }
      }
      let job
      try { job = await getJob(task.task_id) } catch { /* 损坏记录保留在索引中，阻止错误接管但不终止其他对账。 */ }
      const settled = job && terminalStatus(job.status) && await readJson(join(jobRoot(task.task_id), 'settled.json'))
      const closed = job && settled?.status === job.status && settled.finished_at === job.finished_at
      if (!closed && !indexed.has(task.task_id)) {
        driver.entries.push({ seq: task.seq, task_id: task.task_id, lane_id: task.lane.id })
        driver.lanes[task.lane.id] ||= { priority: task.lane.priority, paused: false }
        indexed.add(task.task_id)
      }
    }
    await saveDriver(driver)
    return driver.entries.map(entry => ({ ...entry }))
  })
}

export async function driveOnce({ full = false } = {}) {
  const entries = await reconcile(full)
  const statuses = new Map()
  for (const entry of entries) {
    try { statuses.set(entry.task_id, (await getJob(entry.task_id)).status) } catch { /* 单任务损坏不停驱动 */ }
  }
  for (const entry of entries) if (terminalStatus(statuses.get(entry.task_id))) await settle(entry.task_id)
  const next = await withQueueLock(async () => {
    const driver = await loadDriver()
    for (let index = driver.entries.length - 1; index >= 0; index--) {
      const entry = driver.entries[index], job = await getJob(entry.task_id).catch(() => null)
      if (!job || !terminalStatus(job.status)) continue
      const settled = await readJson(join(jobRoot(entry.task_id), 'settled.json'))
      if (settled?.status === job.status && settled.finished_at === job.finished_at) driver.entries.splice(index, 1)
    }
    await saveDriver(driver)
    const current = new Map()
    for (const entry of driver.entries) {
      try { current.set(entry.task_id, (await getJob(entry.task_id)).status) }
      catch { current.set(entry.task_id, 'unknown') }
    }
    return selectNext(driver, current)
  })
  if (next) await dispatch(next.task_id)
  return { active: [...statuses.values()].some(status => ['pending', 'queued', 'running'].includes(status)) || Boolean(next) }
}

export function createTaskDriver({ execute = action => action(), logger = console, driveProjects = async () => ({ active: false }) } = {}) {
  let timer, stopped = true, running = false, fullAt = 0
  const schedule = delay => { if (!stopped) { timer = setTimeout(loop, delay); timer.unref?.() } }
  const loop = async () => {
    if (stopped || running) return
    running = true
    try {
      const now = Date.now(), full = now >= fullAt
      const result = await execute(() => driveOnce({ full }))
      const projects = await execute(driveProjects)
      if (full) fullAt = now + FULL_RECONCILE_INTERVAL
      schedule(result.active || projects.active ? ACTIVE_INTERVAL : IDLE_INTERVAL)
    } catch (error) {
      logger?.error?.(`[elysium] task driver: ${error.stack || error.message}`)
      schedule(ACTIVE_INTERVAL)
    } finally { running = false }
  }
  const wake = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(loop, 0); timer.unref?.() }
  return {
    start() { if (!stopped) return; stopped = false; setDriverWake(wake); wake() },
    stop() { stopped = true; clearTimeout(timer); setDriverWake() },
    wake,
  }
}
