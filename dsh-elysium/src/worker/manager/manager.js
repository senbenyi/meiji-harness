// 职责：持久化受理任务，并提供派发、结算、取消、暂停和人工重试命令；不编排业务顺序。
import { createHash, randomBytes } from 'node:crypto'
import { access, readFile, readdir, rm, writeFile } from '../../database/files.js'
import { join } from 'node:path'
import { readJson, saveJson } from '../../database/json.js'
import { jobsRoot } from '../../database/paths.js'
import { ModelTaskError } from '../../utils/errors.js'
import { bindActiveJobCall } from '../intake/call-bindings.js'
import { routeTask, validateRoutedTask } from '../routing/route.js'
import { readBackend } from '../models/index.js'
import { getJob } from '../runner/inspect.js'
import { launch } from '../runner/launcher.js'
import { withLaunchLock } from '../store/lock.js'
import { createJob } from '../store/records.js'
import { jobRoot } from '../store/paths.js'
import { saveStatus, terminalStatus } from '../store/status.js'
import { appendHistory } from '../store/history.js'
import { stopWorker } from '../runner/owner.js'
import { CAPABILITIES, assertRetryAllowed, invalid, kindOf, resubmitFailed, retriedThisTurn, reusableTask } from './policy.js'
import { loadDriver, saveDriver, withQueueLock } from './queue.js'
import { jobReferences, listTasks, readTask, requestHash, taskFile, taskId, validateSubmission, writeTask } from './tasks.js'
import { sinkFor } from './sinks.js'

let wake = () => {}
export const setDriverWake = callback => { wake = callback || (() => {}) }
const handle = job => ({ job_id: job.job_id, project_id: job.project_id, status: job.status })
const conflict = () => new ModelTaskError('SUBMISSION_CONFLICT', '[SUBMISSION_CONFLICT] submission_id 已用于不同请求', 409)
const hash16 = value => createHash('sha256').update(value).digest('hex').slice(0, 16)
const submissionIdentity = invocation => invocation?.sessionId && invocation?.callId
  ? `s-${createHash('sha256').update(JSON.stringify([invocation.sessionId, invocation.callId])).digest('hex').slice(0, 32)}`
  : `s-${randomBytes(16).toString('hex')}`
const laneIdentity = (projectId, invocation) => invocation?.sessionId ? `session-${hash16(invocation.sessionId)}` : `project-${projectId}-interactive`

async function routeAll(tasks) {
  const routed = await Promise.all(tasks.map(async (task, index) => {
    try { return { index, ...await routeTask(task.kind, task.plan, { deferReferences: jobReferences(task.plan) }) } } catch (error) { return { index, error } }
  }))
  const errors = routed.filter(item => item.error)
  if (errors.length) {
    const error = invalid(errors.map(item => `第 ${item.index + 1} 个任务: ${item.error.message}`).join('; '))
    error.errors = errors.map(item => ({ index: item.index, code: item.error.code, message: item.error.message }))
    throw error
  }
  return routed
}

async function validateReferences(tasks, ids, laneId) {
  for (const [index, task] of tasks.entries()) for (const reference of jobReferences(task.plan)) {
    const currentIndex = ids.indexOf(reference)
    if (currentIndex >= 0) {
      if (currentIndex >= index) throw invalid(`第 ${index + 1} 个任务引用了未排在其前的任务`)
      continue
    }
    let job
    try { job = await getJob(reference) } catch (error) { if (error.code !== 'MODEL_JOB_NOT_FOUND') throw error }
    if (job?.status === 'succeeded') continue
    const prior = await readTask(reference)
    if (!prior || prior.lane?.id !== laneId) throw invalid(`第 ${index + 1} 个任务引用的 Job 未成功且不在同一泳道之前`)
  }
}

async function receipt(records, driver) {
  const statuses = await Promise.all(records.map(task => getJob(task.task_id)))
  return { submission_id: records[0].submission_id, lane_id: records[0].lane.id, accepted_at: records[0].submitted_at,
    tasks: records.map((task, index) => ({ index: task.index, task_id: task.task_id, seq: task.seq, status: statuses[index].status,
      position: Math.max(0, driver.entries.findIndex(entry => entry.task_id === task.task_id) + 1) })) }
}

async function synchronizeNextSeq(driver) {
  const tasks = await listTasks()
  driver.next_seq = Math.max(driver.next_seq, ...tasks.map(task => Number.isSafeInteger(task.seq) ? task.seq + 1 : 1))
}

async function resumeExisting(request, ids, hash) {
  const result = await withQueueLock(async () => {
    const driver = await loadDriver(), records = []
    await synchronizeNextSeq(driver)
    for (const [index, id] of ids.entries()) {
      let record = await readTask(id)
      if (!record) {
        const task = request.tasks[index]
        record = { schema_version: 1, task_id: id, submission_id: request.submission_id, index, seq: driver.next_seq++, lane: request.lane,
          project_id: request.project_id, kind: task.kind, plan: task.plan, ...(task.binding === undefined ? {} : { binding: task.binding }),
          channel: request.channel || 'service', request_hash: hash, submitted_at: records[0]?.submitted_at || Date.now() }
        await writeTask(record)
      } else if (record.request_hash !== hash) throw conflict()
      records.push(record)
      try { await access(jobRoot(id)) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        const routed = await routeTask(record.kind, record.plan, { deferReferences: jobReferences(record.plan) })
        await createJob(record.project_id, routed.plan, routed.backend, { id, capability: CAPABILITIES[record.kind],
          origin: { task_id: id, submission_id: record.submission_id, lane_id: record.lane.id, seq: record.seq, binding: record.binding, project_id: record.project_id } })
      }
      const job = await getJob(id), settled = terminalStatus(job.status) && await readJson(join(jobRoot(id), 'settled.json'))
      if (!(settled?.status === job.status && settled.finished_at === job.finished_at) && !driver.entries.some(entry => entry.task_id === id)) {
        driver.entries.push({ seq: record.seq, task_id: id, lane_id: record.lane.id })
      }
      driver.lanes[record.lane.id] ||= { priority: record.lane.priority, paused: false }
    }
    await saveDriver(driver)
    return receipt(records, driver)
  })
  wake()
  return result
}

export async function submit(request, invocation) {
  validateSubmission(request)
  const ids = request.tasks.map((_, index) => taskId(request.submission_id, index))
  const hash = requestHash({ lane: request.lane, project_id: request.project_id, tasks: request.tasks, channel: request.channel })
  const existing = await readTask(ids[0])
  if (existing && existing.request_hash !== hash) throw conflict()
  if (existing) return resumeExisting(request, ids, hash)
  await validateReferences(request.tasks, ids, request.lane.id)
  const routed = await routeAll(request.tasks)
  const result = await withQueueLock(async () => {
    const driver = await loadDriver()
    await synchronizeNextSeq(driver)
    const concurrent = await readTask(ids[0])
    if (concurrent && concurrent.request_hash !== hash) throw conflict()
    const records = []
    for (const [index, task] of request.tasks.entries()) {
      let record = await readTask(ids[index])
      if (!record) {
        const seq = driver.next_seq++
        record = { schema_version: 1, task_id: ids[index], submission_id: request.submission_id, index, seq, lane: request.lane,
          project_id: request.project_id, kind: task.kind, plan: task.plan, ...(task.binding === undefined ? {} : { binding: task.binding }),
          channel: request.channel || (invocation?.sessionId ? 'session' : 'service'), request_hash: hash, submitted_at: Date.now() }
        await writeTask(record)
      } else if (record.request_hash !== hash) throw conflict()
      records.push(record)
      try { await access(jobRoot(record.task_id)) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await createJob(record.project_id, routed[index].plan, routed[index].backend, { id: record.task_id, capability: CAPABILITIES[record.kind],
          origin: { task_id: record.task_id, submission_id: record.submission_id, lane_id: record.lane.id, seq: record.seq, binding: record.binding, project_id: record.project_id } })
      }
      driver.lanes[record.lane.id] ||= { priority: record.lane.priority, paused: false }
      if (!driver.entries.some(entry => entry.task_id === record.task_id)) driver.entries.push({ seq: record.seq, task_id: record.task_id, lane_id: record.lane.id })
    }
    await saveDriver(driver)
    return receipt(records, driver)
  })
  wake()
  return result
}

// 单任务兼容门面：保留复用和原有返回句柄，但不再立即启动 Worker。
export async function submitTask(kind, { project_id: projectId, new_task: newTask = false, ...plan }, invocation) {
  invocation?.signal?.throwIfAborted()
  if (!CAPABILITIES[kind]) throw invalid('任务类型无效')
  if (typeof newTask !== 'boolean') throw invalid('new_task 必须为布尔值')
  const reused = newTask ? null : await reusableTask(kind, projectId, invocation)
  if (reused) {
    bindActiveJobCall(reused.job_id, invocation)
    return handle(reused)
  }
  const result = await submit({ submission_id: submissionIdentity(invocation), lane: { id: laneIdentity(projectId, invocation), priority: 'interactive' },
    project_id: projectId, tasks: [{ kind, plan }], channel: 'session' }, invocation)
  const job = await getJob(result.tasks[0].task_id)
  bindActiveJobCall(job.job_id, invocation)
  return handle(job)
}

export async function dispatch(taskIdValue) {
  return withQueueLock(async () => {
    const task = await readTask(taskIdValue)
    if (!task) throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
    const job = await getJob(task.task_id)
    if (job.status !== 'pending') return handle(job)
    for (const reference of jobReferences(task.plan)) {
      const dependency = await getJob(reference)
      if (['failed', 'cancelled'].includes(dependency.status)) {
        const failed = await saveStatus(jobRoot(task.task_id), { job_id: task.task_id, project_id: task.project_id, capability: CAPABILITIES[task.kind],
          status: 'failed', stage: 'failed', failed_stage: 'reference', error_code: 'REFERENCE_FAILED', error: `依赖任务失败: ${reference}`, finished_at: new Date().toISOString() })
        return handle(failed)
      }
      if (dependency.status !== 'succeeded') return null
    }
    try {
      const backend = await readBackend(jobRoot(task.task_id))
      const routed = await readJson(join(jobRoot(task.task_id), 'input/request.json'))
      const resolved = await resolveReferences(routed, backend)
      await validateRoutedTask(backend, resolved)
      await saveJson(join(jobRoot(task.task_id), 'input/request.json'), resolved)
    } catch (error) {
      const failed = await saveStatus(jobRoot(task.task_id), { job_id: task.task_id, project_id: task.project_id, capability: CAPABILITIES[task.kind],
        status: 'failed', stage: 'failed', failed_stage: 'reference', error_code: error.code || 'REFERENCE_INVALID', error: String(error.message).slice(0, 1000), finished_at: new Date().toISOString() })
      return handle(failed)
    }
    return launch(task.task_id, CAPABILITIES[task.kind])
  })
}

async function resolveReferences(value, backend) {
  if (typeof value === 'string') {
    const match = /^job:([a-f0-9]{32})$/.exec(value)
    if (!match || backend.service !== 'comfyui') return value
    const dependency = await getJob(match[1])
    return dependency.result?.comfyui_view_url || dependency.result?.path || value
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => resolveReferences(item, backend)))
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolveReferences(item, backend)])))
  return value
}

export async function settle(taskIdValue) {
  const task = await readTask(taskIdValue), job = await getJob(taskIdValue)
  if (!task || !terminalStatus(job.status)) return false
  const directory = jobRoot(taskIdValue), settled = await readJson(join(directory, 'settled.json'))
  if (settled?.status === job.status && settled.finished_at === job.finished_at) return true
  try {
    const handler = task.binding?.type && sinkFor(task.binding.type)
    if (handler) await handler(job, task)
    await saveJson(join(directory, 'settled.json'), { status: job.status, finished_at: job.finished_at, settled_at: new Date().toISOString() })
    await appendHistory(directory, 'settled', { status: job.status })
    await rm(join(directory, 'settle-error.json'), { force: true })
    return true
  } catch (error) {
    await saveJson(join(directory, 'settle-error.json'), { error: String(error.message).slice(0, 1000), updated_at: new Date().toISOString() })
    return false
  }
}

async function retryLocked(jobId, kind, consent) {
  const job = await getJob(jobId), taskKind = kind || kindOf(job.capability)
  assertRetryAllowed(job, taskKind, consent)
  if (job.status === 'succeeded') return handle(job)
  if (job.status !== 'failed') throw new ModelTaskError('JOB_STATE_INVALID', '只能重试已失败任务', 409)
  let task = await readTask(jobId), driver = await loadDriver()
  if (!task) {
    const plan = JSON.parse(await readFile(join(jobRoot(jobId), 'input/request.json'), 'utf8'))
    const seq = driver.next_seq++, lane = { id: `legacy-${job.project_id}`, priority: 'batch' }
    task = { schema_version: 1, task_id: jobId, submission_id: `legacy-${jobId}`, index: 0, seq, lane, project_id: job.project_id,
      kind: taskKind, plan, channel: 'legacy', request_hash: requestHash(plan), submitted_at: Date.now() }
    await writeTask(task)
  }
  if (resubmitFailed(job)) await writeFile(join(jobRoot(jobId), 'resume-request.json'), JSON.stringify({ retry_failed: true }), { mode: 0o600 })
  const pending = { job_id: jobId, project_id: job.project_id, capability: job.capability, backend: job.backend, server: job.server,
    status: 'pending', stage: 'pending', trace_id: job.trace_id, parent_job_id: job.parent_job_id, code_version: job.code_version }
  await withLaunchLock(jobRoot(jobId), () => saveStatus(jobRoot(jobId), pending), true)
  await rm(join(jobRoot(jobId), 'recovery-required.json'), { force: true })
  driver.lanes[task.lane.id] ||= { priority: task.lane.priority, paused: false }
  if (!driver.entries.some(entry => entry.task_id === jobId)) driver.entries.push({ seq: task.seq, task_id: jobId, lane_id: task.lane.id })
  await saveDriver(driver)
  return handle(pending)
}

export async function retry(jobId, { kind, consent = false } = {}) {
  const observed = await getJob(jobId)
  if (['queued', 'running'].includes(observed.status) && observed.recovery_required) {
    if (!consent) throw new ModelTaskError('MODEL_RETRY_CONFIRMATION_REQUIRED', '恢复任务需要明确确认', 409)
    const directory = jobRoot(jobId)
    await appendHistory(directory, 'manual-recovery-requested', { reason: observed.recovery_reason })
    await stopWorker(join(directory, 'worker.lock'), jobId)
    await getJob(jobId)
  }
  const result = await withQueueLock(() => retryLocked(jobId, kind, consent))
  await appendHistory(jobRoot(jobId), 'retry-queued', { kind: kind || null })
  wake()
  return result
}

// 恢复兼容门面：人工重试只重新入队。
export async function retryTask(jobId, { kind, invocation, consent = false } = {}) {
  invocation?.signal?.throwIfAborted()
  const job = await getJob(jobId), taskKind = kind || kindOf(job.capability)
  assertRetryAllowed(job, taskKind, consent)
  const result = job.status === 'succeeded' || await retriedThisTurn(taskKind, jobId, invocation) ? handle(job) : await retry(jobId, { kind: taskKind, consent })
  bindActiveJobCall(jobId, invocation)
  return result
}

export async function cancel(taskIdValue) {
  const result = await withQueueLock(async () => {
    const job = await getJob(taskIdValue)
    if (job.status !== 'pending') throw new ModelTaskError('JOB_STATE_INVALID', '只能取消待派发任务', 409)
    return withLaunchLock(jobRoot(taskIdValue), () => saveStatus(jobRoot(taskIdValue), { ...job, status: 'cancelled', stage: 'cancelled', finished_at: new Date().toISOString() }), true)
  })
  wake()
  return handle(result)
}

export async function cancelLane(laneId, { from_seq: fromSeq = 0 } = {}) {
  const result = await withQueueLock(async () => {
    const tasks = (await listTasks()).filter(task => task.lane?.id === laneId && task.seq >= fromSeq).sort((a, b) => a.seq - b.seq)
    const cancelled = []
    for (const task of tasks) {
      const job = await getJob(task.task_id)
      if (job.status !== 'pending') continue
      await withLaunchLock(jobRoot(task.task_id), () => saveStatus(jobRoot(task.task_id), { ...job, status: 'cancelled', stage: 'cancelled', finished_at: new Date().toISOString() }), true)
      cancelled.push(task.task_id)
    }
    return { lane_id: laneId, cancelled }
  })
  wake()
  return result
}

async function setPaused(laneId, pausedValue) {
  const result = await withQueueLock(async () => {
    const driver = await loadDriver()
    if (!driver.lanes[laneId]) throw new ModelTaskError('MODEL_INPUT_INVALID', '泳道不存在', 404)
    driver.lanes[laneId].paused = pausedValue
    await saveDriver(driver)
    return { lane_id: laneId, paused: pausedValue }
  })
  wake()
  return result
}
export const pause = laneId => setPaused(laneId, true)
export const resume = laneId => setPaused(laneId, false)

export async function getLane(laneId) {
  const driver = await loadDriver()
  const tasks = (await listTasks()).filter(task => task.lane?.id === laneId).sort((a, b) => a.seq - b.seq)
  return { lane_id: laneId, ...driver.lanes[laneId], tasks: await Promise.all(tasks.map(async task => {
    const job = await getJob(task.task_id), settled = await readJson(join(jobRoot(task.task_id), 'settled.json'))
    return { task_id: task.task_id, seq: task.seq, status: job.status, position: driver.entries.findIndex(entry => entry.task_id === task.task_id) + 1, settled: Boolean(settled) }
  })) }
}

export async function removeProjectTasks(projectId) {
  const tasks = (await listTasks()).filter(task => task.project_id === projectId)
  const ids = new Set(tasks.map(task => task.task_id))
  const entries = await readdir(jobsRoot(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name) || ids.has(entry.name)) continue
    const status = await readJson(join(jobsRoot(), entry.name, 'status.json'))
    if (status?.project_id === projectId) ids.add(entry.name)
  }
  for (const id of ids) {
    const job = await getJob(id)
    if (job.status === 'pending') await cancel(id)
    else if (['queued', 'running'].includes(job.status)) throw new ModelTaskError('PROJECT_TASK_ACTIVE', '项目仍有正在执行的任务', 409)
  }
  await withQueueLock(async () => {
    const driver = await loadDriver()
    driver.entries = driver.entries.filter(entry => !ids.has(entry.task_id))
    await saveDriver(driver)
    await Promise.all([...ids].flatMap(id => [rm(jobRoot(id), { recursive: true, force: true }), rm(taskFile(id), { force: true })]))
  })
  return { removed: ids.size }
}
