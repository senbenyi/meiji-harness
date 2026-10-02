// 任务与步骤的存储：projects/<projectId>/history/tasks/<taskId>.json（schemaVersion 2）与内容快照 artifacts。
// 任务开始时写入完整步骤计划（未执行）；执行器通过 runStep 把实际执行对应到计划步骤（种类 + 目标），
// 计划外的步骤追加在后面。任务状态只由 shared/steps.js 的 deriveTaskStatus 从步骤推导，写入文件只是缓存。
import { assertDrama } from '../../shared/drama-model.js'
import { StepStatus, deriveTaskStatus, latestVerdicts } from '../../shared/steps.js'
import { readProjectFile } from './project-files.js'
import { notifyProject } from './project-events.js'
import { loadSkillSet } from './skill-store.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

export const TASK_SCHEMA = 2
export const executionContext = new AsyncLocalStorage()
const writes = new Map()
const validId = /^[a-zA-Z0-9_-]+$/
const now = () => new Date().toISOString()
// 人工编辑：保存后内容待审（见 prepareContentRecords）。
export const manualActions = new Set(['episode-add', 'episode-edit', 'source', 'outline-text', 'scene-text', 'character-text', 'storyboard-text', 'shot-assets'])
// 由人发起的操作，任务与步骤的执行者记为 human。
const humanActions = new Set([...manualActions, 'overview', 'confirm-image', 'discard-image', 'clear-image', 'use-asset', 'import-image', 'part-import', 'part-text', 'set-reference', 'clear-reference', 'review-override', 'prop-delete'])
// 不写任务记录：没有项目，或会删除记录所在目录。
const unrecorded = new Set(['create', 'open', 'library-import', 'project-delete', 'episode-delete'])
export const recorded = operation => Boolean(operation?.projectId) && !unrecorded.has(operation.action)
const stages = { 'episode-generate': 'summary', 'episode-edit': 'summary', 'episode-add': 'summary', source: 'summary', outline: 'story', 'outline-text': 'story', characters: 'story', scenes: 'story', 'scene-text': 'story', 'character-text': 'story', shots: 'shots', 'revise-shot': 'shots', seconds: 'seconds', 'shot-seconds': 'seconds', storyboard: 'storyboard', 'shot-storyboard': 'storyboard', 'shot-boards': 'storyboard', 'storyboard-text': 'storyboard', film: 'film', films: 'film', assemble: 'assembly' }

// 进行中任务的最新记录（同步读取，供任务查询与「当前任务」页）。
const live = new Map()
export const liveTask = id => live.get(id) || null

export function oldTaskRecordsError(projectId) {
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

function planStep({ kind, target = null, label = null, phase }, actor) {
  return { id: randomUUID(), kind, target, label, ...(phase ? { phase } : {}), status: StepStatus.PENDING, verdict: null, reasons: [], error: null, actor, attempts: [], inputs: [], outputs: [], startedAt: null, endedAt: null }
}

// 任务开始（或进入队列）时写入记录与完整步骤计划。plan 为 [{ kind, target }]。
export async function createTaskRecord(home, operation, id, plan) {
  if (!recorded(operation)) return null
  const actor = humanActions.has(operation.action) ? 'human' : 'model'
  const steps = (plan?.length ? plan : [{ kind: 'execute' }]).map(step => planStep(step, actor))
  const record = { schemaVersion: TASK_SCHEMA, id, projectId: operation.projectId, episodeId: operation.episodeId || null,
    action: operation.action, source: operation.origin || 'api', actor, sessionId: operation.sessionId || null,
    mode: operation.mode || operation.generationMode || (manualActions.has(operation.action) ? 'edit' : 'generate'), requirements: operation.requirements || '', opinion: operation.review || operation.instruction || '',
    status: deriveTaskStatus(steps), startedAt: now(), endedAt: null, steps, artifacts: [], latestOutputs: [], error: null }
  await recordStore(home, operation.projectId).update('tasks', id, record)
  live.set(id, record)
  notifyProject(home, operation.projectId)
  return record
}

// 任务出队开始执行：复用入队时写入的记录（没有则新建）；步骤仍全部未执行时按最新内容重写计划
// （排队期间镜头数等可能变化），并把第一个步骤记为「准备中」的执行中，直到执行器真正开始某个步骤。
export async function beginTask(home, operation, id, plan) {
  if (!recorded(operation)) return null
  const store = recordStore(home, operation.projectId)
  let record = null
  try { record = await store.read('tasks', id) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!record || record.endedAt) record = await createTaskRecord(home, operation, id, plan)
  if (record.steps.every(step => step.status === StepStatus.PENDING)) {
    record = await store.update('tasks', id, task => {
      const steps = plan?.length ? plan.map(step => planStep(step, task.actor)) : task.steps
      Object.assign(steps[0], { status: StepStatus.RUNNING, preparing: true, startedAt: now() })
      return { ...task, steps, status: deriveTaskStatus(steps) }
    })
    live.set(id, record)
    notifyProject(home, operation.projectId)
  }
  return record
}

// 进入执行。嵌套操作（逐镜成片调用的子操作）复用外层任务的上下文，步骤写入同一个任务，按 scope 区分。
export async function startExecution(home, operation, id, plan) {
  if (!recorded(operation)) return null
  const parent = executionContext.getStore()
  const stage = stages[operation.action]
  if (parent && parent.taskId === id) {
    const project = assertDrama(await readProjectFile(home, operation.projectId))
    await addBaselines(parent.store, project, operation, stage, parent.baselines)
    return { ...parent, operation, stage, nested: true, scope: randomUUID() }
  }
  const store = recordStore(home, operation.projectId)
  const record = await beginTask(home, operation, id, plan)
  const project = assertDrama(await readProjectFile(home, operation.projectId))
  const baselines = new Map()
  await addBaselines(store, project, operation, stage, baselines)
  // 任务开始时固定技能组合（内置 + 基础 + 本剧），同一任务内的全部请求（含嵌套子操作）使用同一份。
  const skillSet = await loadSkillSet(home, project.skills)
  skillSet.nodeSupplements = structuredClone(Object.fromEntries(project.episodes.map(episode => [episode.id, episode.supplementalSkills || {}])))
  return { store, home, taskId: id, projectId: operation.projectId, operation, stage, baselines, outputs: [], steps: record.steps, signal: null, stepId: null, scope: 'root', skillSet, skills: new Map() }
}

// 当前任务固定的技能组合；不在任务中时为 null（由调用方使用内置 + 本剧）。
export const taskSkillSet = () => executionContext.getStore()?.skillSet || null

// 记录本任务实际使用的技能（写入任务记录 skills，历史中显示所用技能与层）。
export function useSkills(entries) {
  const context = executionContext.getStore()
  if (!context?.skills) return
  for (const entry of entries) context.skills.set(entry.id + ':' + (entry.nodeKey || ''), entry)
}

async function addBaselines(store, project, operation, stage, baselines) {
  for (const target of contentTargets(project)) {
    if (!target.exists || (operation.episodeId && target.episodeId !== operation.episodeId) || target.key.split(':')[0] !== stage || (operation.track && target.key.includes(':') && target.key.split(':')[1] !== operation.track)) continue
    let source = target.node.source
    if (!source) {
      source = { artifactId: randomUUID(), version: 1, taskId: null, stepId: null }
      await store.update('artifacts', source.artifactId, { schemaVersion: 1, id: source.artifactId, ...source, projectId: project.id, episodeId: target.episodeId, target: target.key, content: target.content, createdAt: now(), published: true, baseline: true })
    }
    baselines.set(`${target.episodeId}:${target.key}`, source)
  }
}

const usedSkills = context => context.skills?.size ? { skills: [...context.skills.values()] } : {}

async function writeSteps(context, extra) {
  const record = await context.store.update('tasks', context.taskId, task => ({ ...task, ...(extra ? extra(task) : {}), ...usedSkills(context), steps: context.steps, status: deriveTaskStatus(context.steps) }))
  live.set(context.taskId, record)
  notifyProject(context.home, context.projectId)
  return record
}

// 请求前保存精确提示词；步骤只带引用，任务列表不携带大段文本、密钥或参考图。
export async function recordStepPrompt({ kind, messages, prompt }) {
  const context = executionContext.getStore()
  const step = context?.steps.find(item => item.id === context.stepId)
  if (!step) return
  const content = messages ? { messages: messages.map(({ role, content }) => ({ role, content })) } : { prompt }
  const id = randomUUID()
  const snapshot = { id, taskId: context.taskId, stepId: step.id, episodeId: context.operation.episodeId || null,
    kind, createdAt: now(), ...structuredClone(content) }
  await context.store.update('prompts', id, snapshot)
  step.prompts = [...(step.prompts || []), { id, kind, createdAt: snapshot.createdAt }]
  await writeSteps(context)
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

function unprepare(step) {
  delete step.preparing
  Object.assign(step, { status: StepStatus.PENDING, startedAt: null })
}

// 任务结束时落定步骤：
// - 被中止：执行中的步骤记为已取消；尚未开始时，第一个未执行步骤记为已取消；
// - 内容校验不通过（CONTENT_CHECK_FAILED）：若最新结论中还没有不通过，追加一个 check 步骤记录结论；
// - 其他错误：若还没有失败步骤，执行中或第一个未执行步骤记为失败；
// - 没有失败或取消时，剩余未执行的步骤记为已跳过。
export function finalizeSteps(steps, error, signal) {
  const at = now()
  // 准备中的步骤没有真正开始：正常结束或内容校验不通过时恢复为未执行（随后记为已跳过）。
  if (!signal?.aborted && (!error || error.code === 'CONTENT_CHECK_FAILED')) for (const step of steps) if (step.preparing) unprepare(step)
  const open = () => steps.find(step => step.status === StepStatus.RUNNING) || steps.find(step => step.status === StepStatus.PENDING)
  const mark = (status, extra = {}) => {
    const step = open()
    if (step) { delete step.preparing; Object.assign(step, { status, endedAt: at, ...extra }) }
    else steps.push({ ...planStep({ kind: 'execute' }, 'model'), status, endedAt: at, ...extra })
  }
  if (signal?.aborted) {
    for (const step of steps) if (step.status === StepStatus.RUNNING) { delete step.preparing; Object.assign(step, { status: StepStatus.CANCELLED, endedAt: at, error: error?.message || '任务已停止' }) }
    if (!steps.some(step => step.status === StepStatus.CANCELLED)) mark(StepStatus.CANCELLED, { error: error?.message || '任务已停止' })
  } else if (error?.code === 'CONTENT_CHECK_FAILED') {
    if (![...latestVerdicts(steps).values()].includes('fail')) {
      const target = [...steps].reverse().find(step => step.target)?.target || null
      steps.push({ ...planStep({ kind: 'check', target }, 'model'), status: StepStatus.COMPLETED, verdict: 'fail', reasons: [error.message], startedAt: at, endedAt: at })
    }
  } else if (error && !steps.some(step => step.status === StepStatus.FAILED || step.status === StepStatus.CANCELLED)) {
    mark(StepStatus.FAILED, { error: error.message, ...(error.apiFailure ? { apiFailure: true } : {}) })
  }
  if (!steps.some(step => step.status === StepStatus.FAILED || step.status === StepStatus.CANCELLED)) {
    for (const step of steps) if (step.status === StepStatus.PENDING) Object.assign(step, { status: StepStatus.SKIPPED, endedAt: at })
  }
  return steps
}

export async function endExecution(context, error, signal) {
  if (!context || context.nested) return
  finalizeSteps(context.steps, error, signal)
  const record = await context.store.update('tasks', context.taskId, task => ({ ...task, ...usedSkills(context), steps: context.steps, status: deriveTaskStatus(context.steps), latestOutputs: context.outputs, endedAt: now(),
    error: error?.message || context.steps.find(step => step.error)?.error || null }))
  live.delete(context.taskId)
  notifyProject(context.home, context.projectId)
  return record
}

// 从未进入执行的任务（排队中被取消或启动前出错）直接落定。
export async function abandonTask(home, projectId, id, error, signal) {
  let record = null
  try { record = await recordStore(home, projectId).read('tasks', id) } catch (reason) { if (reason.code === 'ENOENT') return null; throw reason }
  if (record.endedAt) return record
  const steps = finalizeSteps(structuredClone(record.steps), error, signal)
  const saved = await recordStore(home, projectId).update('tasks', id, task => ({ ...task, steps, status: deriveTaskStatus(steps), endedAt: now(), error: error?.message || null }))
  live.delete(id)
  notifyProject(home, projectId)
  return saved
}

// 执行一个步骤：按种类与目标对应到第一个未执行的计划步骤，否则追加。
// 结果带 check 时记录审核结论；内容校验不通过记为「完成 + 不通过」；中止记为已取消，其他错误记为失败。
export async function runStep(kind, run, detail = {}) {
  const context = executionContext.getStore()
  if (!context) return run()
  const target = detail.target ?? null
  let step = context.steps.find(item => (item.status === StepStatus.PENDING || item.preparing) && item.kind === kind && (item.target ?? null) === target && (item.phase ?? null) === (detail.phase ?? null))
  // 开始的不是准备中的步骤时，准备中的步骤恢复为未执行。
  for (const item of context.steps) if (item.preparing && item !== step) unprepare(item)
  if (step) delete step.preparing
  if (!step) {
    step = { ...planStep({ kind, target, label: detail.label, phase: detail.phase }, context.steps[0]?.actor || 'model'), unplanned: true }
    context.steps.push(step)
  } else if (detail.label) step.label = detail.label
  const outputs = target ? context.outputs.filter(item => item.target === target) : context.outputs
  const baselines = [...context.baselines.entries()].filter(([key]) => !target || key.endsWith(':' + target)).map(([, value]) => value)
  Object.assign(step, { status: StepStatus.RUNNING, scope: context.scope, startedAt: now(), inputs: [...new Set((outputs.length ? outputs : baselines).map(item => item.artifactId))], ...(detail.remoteId ? { remoteId: detail.remoteId } : {}) })
  await writeSteps(context)
  return executionContext.run({ ...context, stepId: step.id }, async () => {
    try {
      const result = await run()
      Object.assign(step, { status: StepStatus.COMPLETED, endedAt: now(), ...(result?.check ? { verdict: result.check.passed ? 'pass' : 'fail', reasons: result.check.failures || [] } : {}) })
      await writeSteps(context)
      return result
    } catch (error) {
      if (error.code === 'CONTENT_CHECK_FAILED' && !context.signal?.aborted) Object.assign(step, { status: StepStatus.COMPLETED, verdict: 'fail', reasons: [error.message], endedAt: now() })
      else Object.assign(step, { status: context.signal?.aborted ? StepStatus.CANCELLED : StepStatus.FAILED, error: error.message, ...(error.apiFailure ? { apiFailure: true } : {}), endedAt: now() })
      await writeSteps(context)
      throw error
    }
  })
}

// 分阶段展开（预留给整集一键）：计划中以 { kind: 'stage', target } 占位，前序通过后替换为具体步骤。
export async function expandStage(target, plan) {
  const context = executionContext.getStore()
  if (!context) return
  const index = context.steps.findIndex(step => step.kind === 'stage' && step.target === target && step.status === StepStatus.PENDING)
  if (index < 0) return
  context.steps.splice(index, 1, ...plan.map(step => planStep(step, context.steps[index].actor)))
  await writeSteps(context)
}

// 同一步骤内的一次尝试（如每秒指令续传），记录在步骤的 attempts 中，不拆成独立步骤。
export async function stepAttempt(label, run) {
  const context = executionContext.getStore()
  const step = context?.steps.find(item => item.id === context.stepId)
  if (!step) return run()
  const attempt = { label, status: StepStatus.RUNNING, startedAt: now(), endedAt: null }
  step.attempts = [...(step.attempts || []), attempt]
  await writeSteps(context)
  try {
    const result = await run()
    attempt.status = StepStatus.COMPLETED
    return result
  } catch (error) {
    attempt.status = StepStatus.FAILED
    attempt.error = error.message
    throw error
  } finally {
    attempt.endedAt = now()
    await writeSteps(context)
  }
}

// 本操作执行过的步骤（执行器之外为空；一键成片的每个子操作只看自己的步骤），以及正在执行的步骤。
export function executionSteps(context = executionContext.getStore()) {
  return context ? context.steps.filter(step => step.scope === context.scope) : []
}
export function activeStep() {
  const context = executionContext.getStore()
  return context?.steps.find(item => item.id === context.stepId) || null
}

const omitted = new Set(['revision', 'status', 'check', 'review', 'draft', 'operation', 'error', 'dependencies', 'stale', 'source', 'image', 'parts', 'localPath', 'assetId', 'assetCategory'])
const textData = value => JSON.parse(JSON.stringify(value, (key, item) => omitted.has(key) ? undefined : item))
export function contentTargets(project) {
  return project.episodes.flatMap(episode => {
    const storyChecks = [episode.plot.outline.check, episode.plot.characters.check, episode.plot.scenes.check, ...(episode.plot.props ? [episode.plot.props.check] : [])]
    const storyCheck = { passed: storyChecks.some(check => check.passed === false) ? false : storyChecks.every(check => check.passed === true) ? true : null,
      failures: [...new Set(storyChecks.flatMap(check => check.failures || []))] }
    const entries = [
      ['summary', episode.summary, { summary: episode.summary.content, durationSeconds: episode.durationSeconds }],
      ['story', episode.plot, { outline: episode.plot.outline.content, characters: textData(episode.plot.characters.items), scenes: textData(episode.plot.scenes.items), props: textData(episode.plot.props?.items || []) }],
      ['shots', episode.shots, episode.shots.items.map(shot => ({ id: shot.id, duration: shot.duration, content: shot.content, cast: shot.cast, scene: shot.scene, reference_images: shot.reference_images }))],
      ['seconds', episode.shots.seconds, episode.shots.items.map(shot => ({ id: shot.id, duration: shot.duration, content: shot.seconds.content }))],
      ['assembly', episode.assembly, episode.assembly.content],
      ...episode.shots.items.flatMap(shot => [['storyboard', shot.storyboard], ['film', shot.video]].map(([kind, node]) => [`${kind}:${shot.id}`, node, kind === 'film' ? node.content?.file ? { file: node.content.file, url: node.content.url } : null : node.content])),
    ]
    return entries.map(([key, node, content]) => ({ episodeId: episode.id, key, node, content,
      check: key === 'story' ? storyCheck : node.check,
      exists: key === 'story' ? Boolean(content.outline || content.characters.length || content.scenes.length) : key === 'seconds' ? content.some(item => item.content) : key === 'shots' ? content.length > 0 : key === 'summary' ? Boolean(content.summary) : content != null }))
  })
}

// Snapshots are written before the project; published is set only after its atomic rename.
export async function prepareContentRecords(current, next) {
  const context = executionContext.getStore()
  if (!context) return []
  const oldTargets = new Map(contentTargets(current).map(item => [`${item.episodeId}:${item.key}`, item]))
  const saved = []
  for (const target of contentTargets(next)) {
    const old = oldTargets.get(`${target.episodeId}:${target.key}`)
    const changed = JSON.stringify(target.content) !== JSON.stringify(old?.content)
    if (!changed) {
      if (old?.node.source) target.node.source = structuredClone(old.node.source)
      if (target.node.source && target.check?.passed != null) {
        const output = context.outputs.find(item => item.artifactId === target.node.source.artifactId)
        if (output) output.reviewPassed = target.check.passed
      }
      continue
    }
    if (!target.exists) { delete target.node.source; continue }
    if (manualActions.has(context.operation.action)) {
      const episode = next.episodes.find(item => item.id === target.episodeId)
      const nodes = target.key === 'story' ? [episode.plot.outline, episode.plot.characters, episode.plot.scenes, episode.plot.props].filter(Boolean) : [target.node]
      for (const node of nodes) { node.check = { passed: null, failures: [], revision: node.revision }; if (!node.operation) node.status = 'not-generated' }
      target.check = nodes[0].check
    }
    let previous = old?.node.source || context.baselines.get(`${target.episodeId}:${target.key}`) || null
    if (!previous && !old?.exists) {
      const history = (await context.store.list('artifacts')).filter(item => item.published && item.episodeId === target.episodeId && item.target === target.key).sort((a, b) => b.version - a.version)
      previous = history[0] ? { artifactId: history[0].id, version: history[0].version } : null
    }
    if (old?.exists && !previous) {
      previous = { artifactId: randomUUID(), version: 1, taskId: null, stepId: null }
      await context.store.update('artifacts', previous.artifactId, { schemaVersion: 1, id: previous.artifactId, ...previous, projectId: current.id, episodeId: target.episodeId, target: target.key, content: old.content, createdAt: now(), published: true, baseline: true })
    }
    const source = { taskId: context.taskId, stepId: context.stepId || null, artifactId: randomUUID(), version: (previous?.version || 0) + 1 }
    await context.store.update('artifacts', source.artifactId, { schemaVersion: 1, id: source.artifactId, ...source, projectId: current.id, episodeId: target.episodeId, target: target.key, previousArtifactId: previous?.artifactId || null, content: target.content, createdAt: now(), published: false })
    target.node.source = source
    saved.push({ ...source, episodeId: target.episodeId, target: target.key, reviewPassed: target.check?.passed ?? null })
  }
  return saved
}
export async function commitContentRecords(saved) {
  const context = executionContext.getStore()
  if (!context || !saved.length) return
  for (const item of saved) {
    await context.store.update('artifacts', item.artifactId, artifact => ({ ...artifact, published: true }))
    const index = context.outputs.findIndex(value => value.episodeId === item.episodeId && value.target === item.target)
    if (index < 0) context.outputs.push(item); else context.outputs[index] = item
  }
  const step = context.steps.find(value => value.id === context.stepId)
  if (step) step.outputs = [...step.outputs, ...saved.map(item => item.artifactId)]
  await writeSteps(context, task => ({ episodeId: task.episodeId || saved[0].episodeId, artifacts: [...task.artifacts, ...saved] }))
}

// 不发布的弹框草稿及未通过结构校验的生成原文沿用任务 artifact 与 outputs，不写项目或剧集。
export async function saveTaskDraft(target, content) {
  const context = executionContext.getStore()
  if (!context) throw new Error('草稿需要任务上下文')
  const id = randomUUID()
  const source = { artifactId: id, taskId: context.taskId, stepId: context.stepId, episodeId: context.operation.episodeId || null, target, version: 1, reviewPassed: content.check?.passed ?? null }
  await context.store.update('artifacts', id, { schemaVersion: 1, id, ...source, projectId: context.projectId, content, createdAt: now(), published: false })
  context.outputs.push(source)
  activeStep().outputs.push(id)
  await writeSteps(context, task => ({ artifacts: [...task.artifacts, source] }))
}

export async function readTaskDraft(home, task) {
  if (task.action !== 'episode-summary-draft' || !['completed', 'review_failed'].includes(deriveTaskStatus(task.steps))) return {}
  const output = task.latestOutputs.find(item => item.target === 'summary-draft')
  if (!output) return {}
  const artifact = await recordStore(home, task.projectId).read('artifacts', output.artifactId)
  return { draft: artifact.content }
}
