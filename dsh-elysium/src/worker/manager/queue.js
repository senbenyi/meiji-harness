// 职责：串行化队列读改写，维护可重建驱动索引，并按优先级和泳道轮转选择任务。
import { readJson, saveJson } from '../../database/json.js'
import { driverFile } from '../../database/paths.js'
import { join } from 'node:path'
import { jobRoot } from '../store/paths.js'
import { terminalStatus } from '../store/status.js'
import { listTasks } from './tasks.js'

let operations = Promise.resolve()
const lastLane = new Map()

export function withQueueLock(action) {
  const operation = operations.then(action)
  operations = operation.catch(() => {})
  return operation
}

const empty = () => ({ schema_version: 1, next_seq: 1, lanes: {}, entries: [], rebuilt_at: null, updated_at: Date.now() })
const valid = value => value?.schema_version === 1 && Number.isSafeInteger(value.next_seq) && value.next_seq > 0 && value.lanes && typeof value.lanes === 'object' && Array.isArray(value.entries)

export async function rebuildDriver() {
  const tasks = await listTasks()
  const lanes = {}, entries = []
  let maximum = 0
  for (const task of tasks.sort((a, b) => a.seq - b.seq)) {
    if (!Number.isSafeInteger(task.seq) || !task.lane?.id) continue
    maximum = Math.max(maximum, task.seq)
    lanes[task.lane.id] = { priority: task.lane.priority, paused: false }
    const status = await readJson(join(jobRoot(task.task_id), 'status.json'))
    const settled = await readJson(join(jobRoot(task.task_id), 'settled.json'))
    if (!status || !terminalStatus(status.status) || !settled || settled.status !== status.status || settled.finished_at !== status.finished_at) entries.push({ seq: task.seq, task_id: task.task_id, lane_id: task.lane.id })
  }
  const driver = { ...empty(), next_seq: maximum + 1, lanes, entries, rebuilt_at: Date.now(), updated_at: Date.now() }
  await saveJson(driverFile(), driver)
  return driver
}

export async function loadDriver() {
  try {
    const driver = await readJson(driverFile())
    return valid(driver) ? driver : rebuildDriver()
  } catch (error) {
    if (error instanceof SyntaxError) return rebuildDriver()
    throw error
  }
}

export async function saveDriver(driver) {
  driver.entries.sort((a, b) => a.seq - b.seq)
  driver.updated_at = Date.now()
  await saveJson(driverFile(), driver)
  return driver
}

export async function selectNext(driver, statuses) {
  if ([...statuses.values()].filter(status => ['queued', 'running', 'unknown'].includes(status)).length >= 1) return null
  for (const priority of ['interactive', 'batch']) {
    const heads = new Map()
    for (const entry of driver.entries) {
      if (driver.lanes[entry.lane_id]?.priority !== priority || driver.lanes[entry.lane_id]?.paused || heads.has(entry.lane_id)) continue
      const sameLaneBefore = driver.entries.some(item => item.lane_id === entry.lane_id && item.seq < entry.seq && ['pending', 'queued', 'running'].includes(statuses.get(item.task_id)))
      if (!sameLaneBefore && statuses.get(entry.task_id) === 'pending') heads.set(entry.lane_id, entry)
    }
    const lanes = [...heads.keys()].sort()
    if (!lanes.length) continue
    const previous = lastLane.get(priority), start = previous && lanes.includes(previous) ? (lanes.indexOf(previous) + 1) % lanes.length : 0
    const lane = lanes[start]
    lastLane.set(priority, lane)
    return heads.get(lane)
  }
  return null
}
