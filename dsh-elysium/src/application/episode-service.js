import * as path from 'node:path'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { ensureProjectExists, readJson, writeJsonAtomic, ElysiumError } from '../infrastructure/persistence/store.js'
import {
  ANCHORS_PER_CHAPTER,
  ID_PATTERN,
  TARGET_MAX,
  TARGET_MIN,
  aspectRatioOf,
  assertStyleRatio,
  buildTasks,
  defaultAssets,
  defaultPlan,
  defaultScript,
  initialState,
  now,
  safeId,
  text,
  validatePlan,
} from '../domain/episode.js'

const locks = new Map()

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

function episodeRoot(projectDirectory) {
  return path.join(projectDirectory, 'episodes')
}

export function episodePaths(projectDirectory, episodeId) {
  const dir = path.join(episodeRoot(projectDirectory), safeId(episodeId, 'episodeId'))
  return {
    dir,
    episode: path.join(dir, 'episode.json'),
    script: path.join(dir, 'script.json'),
    assets: path.join(dir, 'assets.json'),
    plan: path.join(dir, 'plan.json'),
    state: path.join(dir, 'state.json'),
    tasks: path.join(dir, 'tasks.json'),
    issues: path.join(dir, 'issues.json'),
    assetArtifacts: path.join(dir, 'artifacts', 'assets'),
    anchors: path.join(dir, 'artifacts', 'anchors'),
    chapters: path.join(dir, 'artifacts', 'chapters'),
    final: path.join(dir, 'artifacts', 'final'),
  }
}


export async function withEpisodeLock(projectId, episodeId, operation) {
  const key = `${projectId}:${episodeId}`
  const previous = locks.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  locks.set(key, current)
  try {
    return await current
  } finally {
    if (locks.get(key) === current) locks.delete(key)
  }
}

export async function episodeCreate(config, body = {}) {
  const projectId = safeId(body.projectId, 'projectId')
  const episodeId = safeId(body.episodeId, 'episodeId')
  const projectDirectory = await ensureProjectExists(config, projectId)
  const p = episodePaths(projectDirectory, episodeId)
  if (await stat(p.dir).catch(() => null)) fail('EPISODE_EXISTS', `单集已存在：${episodeId}`, 409)
  const targetDurationSec = Number(body.targetDurationSec ?? 10)
  if (!Number.isFinite(targetDurationSec) || targetDurationSec < TARGET_MIN || targetDurationSec > TARGET_MAX) {
    fail('VALIDATION_ERROR', `targetDurationSec 必须在 ${TARGET_MIN} 到 ${TARGET_MAX} 秒之间`)
  }
  const stamp = now()
  const stylePrompt = String(body.stylePrompt || '').trim()
  const aspectRatio = aspectRatioOf(body.aspectRatio, stylePrompt)
  assertStyleRatio(stylePrompt, aspectRatio)
  const episode = {
    schemaVersion: 'elysium-episode-2',
    id: episodeId,
    projectId,
    title: text(body.title, 'title', 120),
    sourceText: text(body.sourceText, 'sourceText'),
    targetDurationSec,
    aspectRatio,
    profile: body.profile === 'final' ? 'final' : 'preview',
    budget: Number.isFinite(body.budget) && body.budget >= 0 ? body.budget : null,
    stylePrompt,
    castPrompt: String(body.castPrompt || '').trim(),
    negativePrompt: String(body.negativePrompt || '').trim(),
    compliance: body.compliance && typeof body.compliance === 'object' ? { ...body.compliance } : {},
    createdAt: stamp,
    updatedAt: stamp,
  }
  const plan = validatePlan(body.plan || defaultPlan(body, episodeId, targetDurationSec), episodeId)
  const script = body.script && typeof body.script === 'object' ? { ...body.script, source: body.script.source || 'producer-agent' } : defaultScript(episode, plan)
  const assets = Array.isArray(body.assets) ? body.assets.map(item => ({ ...item })) : defaultAssets(episode)
  const state = initialState(episode)
  const tasks = buildTasks(episode, plan)
  await Promise.all([p.assetArtifacts, p.anchors, p.chapters, p.final].map(dir => mkdir(dir, { recursive: true })))
  await Promise.all([
    writeJsonAtomic(p.episode, episode),
    writeJsonAtomic(p.script, script),
    writeJsonAtomic(p.assets, assets),
    writeJsonAtomic(p.plan, plan),
    writeJsonAtomic(p.state, state),
    writeJsonAtomic(p.tasks, tasks),
    writeJsonAtomic(p.issues, []),
  ])
  return { ok: true, episode, script, assets, plan, state, tasks, issues: [] }
}

export async function loadEpisode(config, projectId, episodeId) {
  const projectDirectory = await ensureProjectExists(config, safeId(projectId, 'projectId'))
  const p = episodePaths(projectDirectory, episodeId)
  if (!(await stat(p.dir).catch(() => null))) fail('EPISODE_NOT_FOUND', `单集不存在：${episodeId}`, 404)
  const [episode, script, assets, plan, state, tasks, issues] = await Promise.all([
    readJson(p.episode), readJson(p.script, null), readJson(p.assets, []), readJson(p.plan), readJson(p.state), readJson(p.tasks, []), readJson(p.issues, []),
  ])
  if (plan?.source === 'auto-draft' && state?.status === 'ready') state.status = 'draft'
  return { p, projectDirectory, episode, script: script || defaultScript(episode, plan), assets, plan, state, tasks, issues }
}

export async function saveEpisode(loaded) {
  loaded.state.updatedAt = now()
  loaded.episode.updatedAt = now()
  await Promise.all([
    writeJsonAtomic(loaded.p.episode, loaded.episode),
    writeJsonAtomic(loaded.p.script, loaded.script),
    writeJsonAtomic(loaded.p.assets, loaded.assets),
    writeJsonAtomic(loaded.p.plan, loaded.plan),
    writeJsonAtomic(loaded.p.state, loaded.state),
    writeJsonAtomic(loaded.p.tasks, loaded.tasks),
    writeJsonAtomic(loaded.p.issues, loaded.issues),
  ])
}

export async function episodeGet(config, body = {}) {
  const loaded = await loadEpisode(config, body.projectId, body.episodeId)
  return { ok: true, episode: loaded.episode, script: loaded.script, assets: loaded.assets, plan: loaded.plan, state: loaded.state, tasks: loaded.tasks, issues: loaded.issues }
}

export async function episodeList(config, body = {}) {
  const projectId = safeId(body.projectId, 'projectId')
  const projectDirectory = await ensureProjectExists(config, projectId)
  const root = episodeRoot(projectDirectory)
  await mkdir(root, { recursive: true })
  const episodes = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue
    try {
      const loaded = await loadEpisode(config, projectId, entry.name)
      episodes.push({ ...loaded.episode, status: loaded.state.status, activeStage: loaded.state.activeStage })
    } catch { /* malformed episodes stay out of the list */ }
  }
  episodes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return { ok: true, episodes }
}

export async function episodeUpdate(config, body = {}) {
  return withEpisodeLock(body.projectId, body.episodeId, async () => {
    const loaded = await loadEpisode(config, body.projectId, body.episodeId)
    if (['running', 'queued'].includes(loaded.state.status)) fail('EPISODE_BUSY', '生产运行中，不能修改上游输入', 409)
    const patch = body.updates && typeof body.updates === 'object' ? body.updates : {}
    const previousProductionInput = JSON.stringify({
      sourceText: loaded.episode.sourceText,
      targetDurationSec: loaded.episode.targetDurationSec,
      aspectRatio: loaded.episode.aspectRatio || '9:16',
      profile: loaded.episode.profile,
      stylePrompt: loaded.episode.stylePrompt,
      castPrompt: loaded.episode.castPrompt,
      negativePrompt: loaded.episode.negativePrompt,
      plan: loaded.plan,
    })
    const previousPlanningInputs = JSON.stringify({
      sourceText: loaded.episode.sourceText,
      targetDurationSec: loaded.episode.targetDurationSec,
      aspectRatio: loaded.episode.aspectRatio || '9:16',
      stylePrompt: loaded.episode.stylePrompt,
      castPrompt: loaded.episode.castPrompt,
    })
    if (patch.sourceText !== undefined) loaded.episode.sourceText = text(patch.sourceText, 'sourceText')
    if (patch.title !== undefined) loaded.episode.title = text(patch.title, 'title', 120)
    if (patch.profile !== undefined) loaded.episode.profile = patch.profile === 'final' ? 'final' : 'preview'
    if (patch.aspectRatio !== undefined) loaded.episode.aspectRatio = patch.aspectRatio === '16:9' ? '16:9' : '9:16'
    if (patch.stylePrompt !== undefined) loaded.episode.stylePrompt = String(patch.stylePrompt || '').trim()
    if (patch.castPrompt !== undefined) loaded.episode.castPrompt = String(patch.castPrompt || '').trim()
    if (patch.negativePrompt !== undefined) loaded.episode.negativePrompt = String(patch.negativePrompt || '').trim()
    if (patch.targetDurationSec !== undefined) {
      const duration = Number(patch.targetDurationSec)
      if (!Number.isFinite(duration) || duration < TARGET_MIN || duration > TARGET_MAX) fail('VALIDATION_ERROR', 'targetDurationSec 超出范围')
      loaded.episode.targetDurationSec = duration
    }
    assertStyleRatio(loaded.episode.stylePrompt, loaded.episode.aspectRatio || '9:16')
    const planningInputsChanged = previousPlanningInputs !== JSON.stringify({
      sourceText: loaded.episode.sourceText,
      targetDurationSec: loaded.episode.targetDurationSec,
      aspectRatio: loaded.episode.aspectRatio || '9:16',
      stylePrompt: loaded.episode.stylePrompt,
      castPrompt: loaded.episode.castPrompt,
    })
    if (patch.plan !== undefined) {
      loaded.plan = validatePlan(patch.plan, loaded.episode.id)
    } else if (planningInputsChanged) {
      loaded.plan = validatePlan(defaultPlan(loaded.episode, loaded.episode.id, loaded.episode.targetDurationSec), loaded.episode.id)
      loaded.plan.source = 'auto-draft'
    }
    if (patch.script && typeof patch.script === 'object') loaded.script = { ...patch.script, source: patch.script.source || 'edited' }
    else if (planningInputsChanged || (loaded.script?.source === 'auto-draft' && patch.plan !== undefined)) loaded.script = defaultScript(loaded.episode, loaded.plan)
    if (Array.isArray(patch.assets)) loaded.assets = patch.assets.map(item => ({ ...item }))
    else if (patch.castPrompt !== undefined || patch.stylePrompt !== undefined) loaded.assets = defaultAssets(loaded.episode)
    const nextProductionInput = JSON.stringify({
      sourceText: loaded.episode.sourceText,
      targetDurationSec: loaded.episode.targetDurationSec,
      aspectRatio: loaded.episode.aspectRatio || '9:16',
      profile: loaded.episode.profile,
      stylePrompt: loaded.episode.stylePrompt,
      castPrompt: loaded.episode.castPrompt,
      negativePrompt: loaded.episode.negativePrompt,
      plan: loaded.plan,
    })
    if (previousProductionInput !== nextProductionInput) {
      loaded.tasks = buildTasks(loaded.episode, loaded.plan, loaded.tasks)
      let invalidated = true
      while (invalidated) {
        invalidated = false
        for (const task of loaded.tasks) {
          if (task.status !== 'succeeded') continue
          if (task.dependencies.some(id => loaded.tasks.find(item => item.id === id)?.status !== 'succeeded')) {
            task.status = 'pending'
            task.remoteJobId = null
            task.error = null
            invalidated = true
          }
        }
      }
      loaded.state.status = loaded.plan.source === 'auto-draft' ? 'draft' : 'ready'
      loaded.state.activeStage = 'story'
      loaded.state.approval = null
      if (loaded.tasks.find(task => task.id === 'final')?.status !== 'succeeded') loaded.state.final = null
    }
    await saveEpisode(loaded)
    return { ok: true, episode: loaded.episode, script: loaded.script, assets: loaded.assets, plan: loaded.plan, state: loaded.state, tasks: loaded.tasks, issues: loaded.issues }
  })
}

export { ANCHORS_PER_CHAPTER, buildTasks, validatePlan }
