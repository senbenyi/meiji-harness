import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { createComfyUiService } from '../infrastructure/comfyui/service.js'
import { ElysiumError, listProjectIds, writeJsonAtomic } from '../infrastructure/persistence/store.js'
import { episodeGet, episodeList, loadEpisode, saveEpisode, withEpisodeLock } from './episode-service.js'

const runners = new Map()

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

function now() {
  return new Date().toISOString()
}

function runnerKey(projectId, episodeId) {
  return `${projectId}:${episodeId}`
}

function outputExtension(file, allowed) {
  const extension = path.extname(file).toLowerCase()
  if (!allowed.includes(extension)) fail('OUTPUT_TYPE_INVALID', `不支持的产物类型：${extension}`, 502)
  return extension
}

async function stableCopy(source, directory, basename, allowed) {
  const actual = await realpath(source).catch(() => null)
  const info = actual ? await stat(actual).catch(() => null) : null
  if (!info?.isFile()) fail('OUTPUT_MISSING', 'ComfyUI 产物路径不存在', 502)
  const extension = outputExtension(actual, allowed)
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, `${basename}-${Date.now()}${extension}`)
  await copyFile(actual, destination)
  return destination
}

async function callComfy(comfy, method, args) {
  const result = await comfy[method](args)
  if (!result?.ok) fail(result?.code || 'COMFYUI_ERROR', result?.message || 'ComfyUI 请求失败', 502)
  return result
}

async function waitForOutput(comfy, jobId, kind) {
  for (;;) {
    const result = await callComfy(comfy, 'job', { job_id: jobId, action: 'wait', wait_s: 20 })
    if (result.status === 'running') continue
    const output = result.outputs?.find(item => item.kind === kind) || result.outputs?.[0]
    if (!output?.path) fail('NO_OUTPUT', `ComfyUI 没有返回 ${kind} 产物`, 502)
    return output.path
  }
}

function taskStage(type) {
  return ({ asset: 'assets', start_frame: 'start_frame', keyframe: 'keyframes', chapter: 'chapters', final: 'final' })[type] || type
}

function modelSettings(config, key, fallbackTemplate, fallbackArgs) {
  const source = config.models?.[key]
  return {
    template: String(source?.template || fallbackTemplate),
    args: source?.args && typeof source.args === 'object' ? { ...fallbackArgs, ...source.args } : { ...fallbackArgs },
  }
}

async function preflightContracts(comfy, config) {
  if (typeof comfy.inspect !== 'function') return
  const checks = [
    ['characterImage', 'qwen-image-t2i', ['prompt']],
    ['startFrame', 'qwen-image-t2i', ['prompt']],
    ['keyframeImage', 'qwen-image-edit', ['prompt', 'image', 'character_image']],
    ['chapterVideo', 'wan22-remix-long', [
      ...Array.from({ length: 6 }, (_, index) => `image_${index + 1}`),
      ...Array.from({ length: 6 }, (_, index) => `prompt_${index + 1}`),
    ]],
  ]
  for (const [key, fallback, required] of checks) {
    const template = modelSettings(config, key, fallback, {}).template
    let inspected
    try { inspected = await comfy.inspect(template) }
    catch (error) { fail(error?.code || 'PREFLIGHT_FAILED', `工作流 ${template} 预检失败：${error?.message || error}`, 422) }
    const slots = inspected?.slots && typeof inspected.slots === 'object' ? inspected.slots : {}
    const missing = required.filter(slot => !slots[slot])
    if (missing.length) fail('WORKFLOW_CONTRACT_INVALID', `工作流 ${template} 缺少输入槽：${missing.join(', ')}`, 422)
  }
}

function imageSettings(episode) {
  const landscape = episode.aspectRatio === '16:9'
  if (episode.profile === 'final') {
    return { width: landscape ? 1536 : 864, height: landscape ? 864 : 1536, steps: 28, cfg: 3.5 }
  }
  return { width: landscape ? 1280 : 720, height: landscape ? 720 : 1280, steps: 20, cfg: 2.5 }
}

function videoSettings(episode) {
  const landscape = episode.aspectRatio === '16:9'
  if (episode.profile === 'final') {
    return { width: landscape ? 768 : 432, height: landscape ? 432 : 768, frames: 65, fps: 16 }
  }
  return { width: landscape ? 624 : 352, height: landscape ? 352 : 624, frames: 49, fps: 12 }
}

function findAnchor(plan, anchorId) {
  for (const chapter of plan.chapters) {
    const anchor = chapter.anchors.find(item => item.id === anchorId)
    if (anchor) return { chapter, anchor }
  }
  fail('ANCHOR_NOT_FOUND', `找不到锚点：${anchorId}`, 404)
}

function relativeToProject(loaded, absolutePath) {
  return path.relative(loaded.projectDirectory, absolutePath).split(path.sep).join('/')
}

async function submitRemoteTask(comfy, config, loaded, task) {
  const { episode, plan } = loaded
  if (task.type === 'asset') {
    const asset = loaded.assets.find(item => item.id === task.entityId)
    const model = modelSettings(config, 'characterImage', 'qwen-image-t2i', imageSettings(episode))
    const prompt = [episode.stylePrompt, asset?.prompt || episode.castPrompt || episode.sourceText].filter(Boolean).join('。')
    const submitted = await callComfy(comfy, 'generate', {
      ...model.args, template: model.template, prompt, negative: episode.negativePrompt,
      seed: parseInt(task.inputHash.slice(0, 8), 16), wait_s: 0,
    })
    return { jobId: submitted.job_id, kind: 'image', directory: loaded.p.assetArtifacts, allowed: ['.png', '.jpg', '.jpeg', '.webp'] }
  }
  if (task.type === 'start_frame' || task.type === 'keyframe') {
    const { chapter, anchor } = findAnchor(plan, task.entityId)
    const first = task.type === 'start_frame'
    const defaults = imageSettings(episode)
    const model = modelSettings(config, first ? 'startFrame' : 'keyframeImage', first ? 'qwen-image-t2i' : 'qwen-image-edit', defaults)
    const prompt = [episode.castPrompt, episode.stylePrompt, anchor.imagePrompt].filter(Boolean).join('。')
    const args = { ...model.args, template: model.template, prompt, negative: episode.negativePrompt, seed: parseInt(task.inputHash.slice(0, 8), 16), wait_s: 0 }
    if (!first) {
      const previous = chapter.anchors[anchor.order - 2]
      const previousTask = loaded.tasks.find(item => item.id === `anchor:${previous.id}`)
      if (!previousTask?.path) fail('DEPENDENCY_MISSING', `${anchor.id} 缺少上一张关键帧`, 409)
      args.image = path.join(loaded.projectDirectory, previousTask.path)
      const castTask = loaded.tasks.find(item => item.id === 'asset:cast-main')
      if (!castTask?.path) fail('DEPENDENCY_MISSING', `${anchor.id} 缺少角色定妆图`, 409)
      args.character_image = path.join(loaded.projectDirectory, castTask.path)
    }
    const submitted = await callComfy(comfy, 'generate', args)
    return { jobId: submitted.job_id, kind: 'image', directory: loaded.p.anchors, allowed: ['.png', '.jpg', '.jpeg', '.webp'] }
  }
  if (task.type === 'chapter') {
    const chapter = plan.chapters.find(item => item.id === task.entityId)
    if (!chapter) fail('CHAPTER_NOT_FOUND', `找不到章节：${task.entityId}`, 404)
    const model = modelSettings(config, 'chapterVideo', 'wan22-remix-long', videoSettings(episode))
    const args = { ...model.args, template: model.template, negative: episode.negativePrompt, seed: parseInt(task.inputHash.slice(0, 8), 16), wait_s: 0 }
    chapter.anchors.forEach((anchor, index) => {
      const anchorTask = loaded.tasks.find(item => item.id === `anchor:${anchor.id}`)
      if (!anchorTask?.path) fail('DEPENDENCY_MISSING', `${chapter.id} 缺少锚点 ${anchor.id}`, 409)
      args[`image_${index + 1}`] = path.join(loaded.projectDirectory, anchorTask.path)
      args[`prompt_${index + 1}`] = anchor.motionPrompt
    })
    const submitted = await callComfy(comfy, 'generate', args)
    return { jobId: submitted.job_id, kind: 'video', directory: loaded.p.chapters, allowed: ['.mp4', '.mov', '.webm', '.mkv'] }
  }
  fail('TASK_TYPE_INVALID', `未知任务类型：${task.type}`)
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16000) })
    child.once('error', error => reject(new ElysiumError('PROCESS_START_FAILED', error.message, 500)))
    child.once('close', code => code === 0 ? resolve() : reject(new ElysiumError('PROCESS_FAILED', stderr.trim() || `${command} exited ${code}`, 500)))
  })
}

async function durationOf(config, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(String(config.ffprobe || 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', error => reject(new ElysiumError('FFPROBE_MISSING', error.message, 500)))
    child.once('close', code => {
      const duration = Number(stdout.trim())
      if (code === 0 && Number.isFinite(duration) && duration > 0) resolve(duration)
      else reject(new ElysiumError('FFPROBE_FAILED', stderr.trim() || '无法读取成片时长', 500))
    })
  })
}

async function assemble(config, episode, sources, destination) {
  if (sources.length === 0) fail('CHAPTERS_REQUIRED', '生成成片前必须完成章节视频', 409)
  await mkdir(path.dirname(destination), { recursive: true })
  const landscape = episode.aspectRatio === '16:9'
  const width = landscape ? 1280 : 720
  const height = landscape ? 720 : 1280
  const filters = sources.map((_, index) => `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${index}]`)
  filters.push(`${sources.map((_, index) => `[v${index}]`).join('')}concat=n=${sources.length}:v=1:a=0[joined]`)
  filters.push(`[joined]minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,trim=duration=${episode.targetDurationSec},setpts=PTS-STARTPTS,format=yuv420p[outv]`)
  const args = ['-y', ...sources.flatMap(file => ['-i', file]), '-filter_complex', filters.join(';'), '-map', '[outv]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', destination]
  await runProcess(String(config.ffmpeg || 'ffmpeg'), args)
  return durationOf(config, destination)
}

async function executeFinal(config, loaded, task) {
  const sources = loaded.plan.chapters.map(chapter => {
    const chapterTask = loaded.tasks.find(item => item.id === `chapter:${chapter.id}`)
    if (!chapterTask?.path) fail('DEPENDENCY_MISSING', `缺少章节视频：${chapter.id}`, 409)
    return path.join(loaded.projectDirectory, chapterTask.path)
  })
  const destination = path.join(loaded.p.final, `final-${Date.now()}.mp4`)
  const duration = await assemble(config, loaded.episode, sources, destination)
  const tolerance = Math.max(2, loaded.episode.targetDurationSec * 0.05)
  const durationDelta = Math.abs(duration - loaded.episode.targetDurationSec)
  const landscape = loaded.episode.aspectRatio === '16:9'
  const qc = {
    passed: durationDelta <= tolerance,
    durationSec: Number(duration.toFixed(3)),
    targetDurationSec: loaded.episode.targetDurationSec,
    durationToleranceSec: Number(tolerance.toFixed(3)),
    resolution: landscape ? '1280x720' : '720x1280', fps: 24, codec: 'h264', checkedAt: now(),
  }
  const qcPath = path.join(loaded.p.final, `qc-${Date.now()}.json`)
  await writeJsonAtomic(qcPath, qc)
  if (!qc.passed) fail('QC_DURATION_FAILED', `成片 ${qc.durationSec} 秒，与目标 ${qc.targetDurationSec} 秒偏差超过 ${qc.durationToleranceSec} 秒`, 422)
  return { path: relativeToProject(loaded, destination), qcPath: relativeToProject(loaded, qcPath), qc }
}

function addIssue(loaded, task, error) {
  const existing = loaded.issues.find(issue => issue.taskId === task.id && issue.status === 'open')
  if (existing) {
    existing.code = error?.code || 'TASK_FAILED'
    existing.message = error?.message || String(error)
    existing.updatedAt = now()
    return
  }
  loaded.issues.push({
    id: `issue-${randomUUID()}`,
    taskId: task.id,
    code: error?.code || 'TASK_FAILED',
    message: error?.message || String(error),
    resolutionOptions: ['retry', 'edit_input'],
    status: 'open', createdAt: now(), updatedAt: now(),
  })
}

async function runOneTask(comfy, config, projectId, episodeId, taskId) {
  let loaded = await loadEpisode(config, projectId, episodeId)
  let task = loaded.tasks.find(item => item.id === taskId)
  if (!task) fail('TASK_NOT_FOUND', `任务不存在：${taskId}`, 404)
  try {
    if (task.type === 'final') {
      task.status = 'running'
      task.attempt += 1
      loaded.state.activeStage = 'final'
      await saveEpisode(loaded)
      const result = await executeFinal(config, loaded, task)
      loaded = await loadEpisode(config, projectId, episodeId)
      task = loaded.tasks.find(item => item.id === taskId)
      task.status = 'succeeded'
      task.path = result.path
      task.error = null
      task.versions = [...(task.versions || []), { path: result.path, inputHash: task.inputHash, createdAt: now() }]
      loaded.state.final = result
      loaded.state.status = 'awaiting_review'
      loaded.state.activeStage = 'review'
      await saveEpisode(loaded)
      return
    }

    task.status = task.remoteJobId ? 'running' : 'queued'
    if (!task.remoteJobId) task.attempt += 1
    loaded.state.activeStage = taskStage(task.type)
    await saveEpisode(loaded)

    let remote
    if (task.remoteJobId) {
      remote = {
        jobId: task.remoteJobId,
        kind: task.type === 'chapter' ? 'video' : 'image',
        directory: task.type === 'chapter' ? loaded.p.chapters : task.type === 'asset' ? loaded.p.assetArtifacts : loaded.p.anchors,
        allowed: task.type === 'chapter' ? ['.mp4', '.mov', '.webm', '.mkv'] : ['.png', '.jpg', '.jpeg', '.webp'],
      }
    } else {
      remote = await submitRemoteTask(comfy, config, loaded, task)
      loaded = await loadEpisode(config, projectId, episodeId)
      task = loaded.tasks.find(item => item.id === taskId)
      task.remoteJobId = remote.jobId
      task.status = 'running'
      await saveEpisode(loaded)
    }
    const source = await waitForOutput(comfy, remote.jobId, remote.kind)
    const destination = await stableCopy(source, remote.directory, task.entityId, remote.allowed)
    loaded = await loadEpisode(config, projectId, episodeId)
    task = loaded.tasks.find(item => item.id === taskId)
    const relativePath = relativeToProject(loaded, destination)
    task.status = 'succeeded'
    task.path = relativePath
    task.remoteJobId = null
    task.error = null
    task.versions = [...(task.versions || []), { path: relativePath, inputHash: task.inputHash, createdAt: now() }]
    await saveEpisode(loaded)
  } catch (error) {
    loaded = await loadEpisode(config, projectId, episodeId)
    task = loaded.tasks.find(item => item.id === taskId)
    task.remoteJobId = null
    task.error = error?.message || String(error)
    if (task.attempt < task.maxAttempts) {
      task.status = 'pending'
    } else {
      task.status = 'needs_attention'
      loaded.state.status = 'needs_attention'
      addIssue(loaded, task, error)
    }
    await saveEpisode(loaded)
  }
}

function dependenciesDone(tasks, task) {
  return task.dependencies.every(id => tasks.find(item => item.id === id)?.status === 'succeeded')
}

async function runEpisode(comfy, config, projectId, episodeId) {
  const key = runnerKey(projectId, episodeId)
  try {
    for (;;) {
      const loaded = await loadEpisode(config, projectId, episodeId)
      if (loaded.state.status === 'paused' || loaded.state.status === 'needs_attention' || loaded.state.status === 'approved') return
      if (loaded.tasks.every(task => task.status === 'succeeded')) {
        if (loaded.state.final?.path && loaded.state.status !== 'approved') {
          loaded.state.status = 'awaiting_review'
          loaded.state.activeStage = 'review'
          await saveEpisode(loaded)
        }
        return
      }
      const task = loaded.tasks.find(item => ['pending', 'queued', 'running'].includes(item.status) && dependenciesDone(loaded.tasks, item))
      if (!task) {
        loaded.state.status = 'needs_attention'
        addIssue(loaded, { id: 'orchestrator' }, new ElysiumError('DEPENDENCY_DEADLOCK', '没有可运行任务，请检查失败或失效的上游任务'))
        await saveEpisode(loaded)
        return
      }
      await runOneTask(comfy, config, projectId, episodeId, task.id)
    }
  } finally {
    runners.delete(key)
  }
}

function launch(comfy, config, projectId, episodeId) {
  const key = runnerKey(projectId, episodeId)
  if (runners.has(key)) return runners.get(key)
  const runner = runEpisode(comfy, config, projectId, episodeId)
  runners.set(key, runner)
  return runner
}

function assertAuthorization(body) {
  if (body.confirmAuthorizedContent !== true) {
    fail('AUTHORIZATION_REQUIRED', '启动生成前必须确认内容合规且素材权利清晰')
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

export function createProductionService(ctx, config = {}, comfy = createComfyUiService(config)) {
  let disposed = false

  async function start(body = {}) {
    assertAuthorization(body)
    const candidate = await loadEpisode(config, body.projectId, body.episodeId)
    if (candidate.plan?.source === 'auto-draft') fail('PLAN_REQUIRED', '请先完成自动规划再开始生产', 409)
    await preflightContracts(comfy, config)
    const result = await withEpisodeLock(body.projectId, body.episodeId, async () => {
      const loaded = await loadEpisode(config, body.projectId, body.episodeId)
      if (loaded.plan?.source === 'auto-draft') fail('PLAN_REQUIRED', '请先完成自动规划再开始生产', 409)
      if (loaded.state.status === 'approved') fail('ALREADY_APPROVED', '当前成片已经验收；修改上游后才能重新生产', 409)
      if (loaded.state.status === 'awaiting_review') fail('REVIEW_PENDING', '当前成片正在等待人工终审', 409)
      if (loaded.state.status === 'needs_attention' && loaded.tasks.some(task => task.status === 'needs_attention')) {
        fail('ISSUE_UNRESOLVED', '请先处理需要人工介入的问题', 409)
      }
      loaded.state.status = 'running'
      loaded.state.authorizedAt = loaded.state.authorizedAt || now()
      loaded.state.approval = null
      await saveEpisode(loaded)
      return { ok: true, accepted: true, state: loaded.state }
    })
    if (!disposed) void launch(comfy, config, body.projectId, body.episodeId)
    return result
  }

  async function pause(body = {}) {
    return withEpisodeLock(body.projectId, body.episodeId, async () => {
      const loaded = await loadEpisode(config, body.projectId, body.episodeId)
      loaded.state.status = 'paused'
      await saveEpisode(loaded)
      return { ok: true, state: loaded.state }
    })
  }

  async function resume(body = {}) {
    const result = await withEpisodeLock(body.projectId, body.episodeId, async () => {
      const loaded = await loadEpisode(config, body.projectId, body.episodeId)
      if (!loaded.state.authorizedAt) fail('AUTHORIZATION_REQUIRED', '该单集尚未获得生产授权')
      if (loaded.state.status === 'needs_attention') fail('ISSUE_UNRESOLVED', '请先处理需要人工介入的问题', 409)
      if (loaded.state.status === 'awaiting_review' || loaded.state.status === 'approved') fail('REVIEW_PENDING', '当前成片不需要继续生产', 409)
      loaded.state.status = 'running'
      await saveEpisode(loaded)
      return { ok: true, accepted: true, state: loaded.state }
    })
    if (!disposed) void launch(comfy, config, body.projectId, body.episodeId)
    return result
  }

  async function retry(body = {}) {
    const result = await withEpisodeLock(body.projectId, body.episodeId, async () => {
      const loaded = await loadEpisode(config, body.projectId, body.episodeId)
      if (loaded.state.status === 'running') fail('EPISODE_BUSY', '生产运行中，不能重置任务', 409)
      const target = loaded.tasks.find(task => task.id === body.taskId)
      if (!target) fail('TASK_NOT_FOUND', `任务不存在：${body.taskId}`, 404)
      const reset = new Set([target.id])
      let changed = true
      while (changed) {
        changed = false
        for (const task of loaded.tasks) {
          if (!reset.has(task.id) && task.dependencies.some(id => reset.has(id))) {
            reset.add(task.id)
            changed = true
          }
        }
      }
      for (const task of loaded.tasks) {
        if (!reset.has(task.id)) continue
        task.status = 'pending'
        task.attempt = 0
        task.remoteJobId = null
        task.error = null
      }
      loaded.issues.forEach(issue => { if (reset.has(issue.taskId)) issue.status = 'resolved' })
      const shouldResume = Boolean(loaded.state.authorizedAt)
      loaded.state.status = shouldResume ? 'running' : 'ready'
      loaded.state.approval = null
      if (reset.has('final')) loaded.state.final = null
      await saveEpisode(loaded)
      return { ok: true, reset: [...reset], state: loaded.state, shouldResume }
    })
    if (result.shouldResume && !disposed) void launch(comfy, config, body.projectId, body.episodeId)
    const { shouldResume: _shouldResume, ...response } = result
    return response
  }

  async function approve(body = {}) {
    if (body.confirmHumanReviewPassed !== true) fail('HUMAN_REVIEW_REQUIRED', '必须完整观看当前成片并明确确认通过')
    const reviewer = String(body.reviewer || '').trim()
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(reviewer)) fail('INVALID_REVIEWER', '审核人标识格式无效')
    return withEpisodeLock(body.projectId, body.episodeId, async () => {
      const loaded = await loadEpisode(config, body.projectId, body.episodeId)
      if (loaded.state.status !== 'awaiting_review' || !loaded.state.final?.path) fail('QC_REQUIRED', '当前成片尚未通过技术 QC', 409)
      const digest = await sha256File(path.join(loaded.projectDirectory, loaded.state.final.path))
      loaded.state.approval = { reviewer, reviewedAt: now(), finalSha256: digest, finalPath: loaded.state.final.path }
      loaded.state.status = 'approved'
      loaded.state.activeStage = 'approved'
      await saveEpisode(loaded)
      return { ok: true, state: loaded.state }
    })
  }

  async function adopt(body = {}) {
    return withEpisodeLock(body.projectId, body.episodeId, async () => {
      const loaded = await loadEpisode(config, body.projectId, body.episodeId)
      const task = loaded.tasks.find(item => item.id === body.taskId)
      if (!task) fail('TASK_NOT_FOUND', `任务不存在：${body.taskId}`, 404)
      const version = task.versions?.find(item => item.path === body.path)
      if (!version || !(await stat(path.join(loaded.projectDirectory, version.path)).catch(() => null))) {
        fail('ARTIFACT_NOT_FOUND', '指定产物版本不存在', 404)
      }
      task.path = version.path
      task.status = 'succeeded'
      const affected = new Set([task.id])
      let changed = true
      while (changed) {
        changed = false
        for (const candidate of loaded.tasks) {
          if (candidate.id !== task.id && !affected.has(candidate.id) && candidate.dependencies.some(id => affected.has(id))) {
            affected.add(candidate.id)
            candidate.status = 'pending'
            candidate.remoteJobId = null
            candidate.error = null
            changed = true
          }
        }
      }
      loaded.state.status = 'ready'
      loaded.state.approval = null
      if (affected.has('final')) loaded.state.final = null
      await saveEpisode(loaded)
      return { ok: true, adopted: version, invalidated: [...affected].filter(id => id !== task.id) }
    })
  }

  async function resolveIssue(body = {}) {
    const loaded = await loadEpisode(config, body.projectId, body.episodeId)
    const issue = loaded.issues.find(item => item.id === body.issueId && item.status === 'open')
    if (!issue) fail('ISSUE_NOT_FOUND', '待处理问题不存在', 404)
    if (body.resolution !== 'retry') fail('RESOLUTION_INVALID', '当前只支持 retry；修改输入请使用 episode.update')
    return retry({ ...body, taskId: issue.taskId })
  }

  async function status(body = {}) {
    return episodeGet(config, body)
  }

  async function resumeAll() {
    for (const projectId of await listProjectIds(config)) {
      const listed = await episodeList(config, { projectId }).catch(() => ({ episodes: [] }))
      for (const episode of listed.episodes) {
        if (episode.status === 'running' && !disposed) void launch(comfy, config, projectId, episode.id)
      }
    }
  }

  return {
    start, pause, resume, retry, adopt, resolveIssue, approve, status, resumeAll,
    dispose() { disposed = true },
  }
}
