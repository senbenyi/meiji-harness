import * as path from 'node:path'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ensureProjectExists, readJson, writeJsonAtomic, ElysiumError } from '../infrastructure/store.js'

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const TARGET_MIN = 20
const TARGET_MAX = 600
const CHAPTER_SECONDS = 20
const ANCHORS_PER_CHAPTER = 6
const locks = new Map()

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

function safeId(value, field) {
  const id = String(value || '').trim()
  if (!ID_PATTERN.test(id)) fail('VALIDATION_ERROR', `${field} 只允许小写字母、数字和连字符`)
  return id
}

function text(value, field, max = 10000) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) fail('VALIDATION_ERROR', `${field} 不能为空`)
  if (result.length > max) fail('VALIDATION_ERROR', `${field} 不能超过 ${max} 个字符`)
  return result
}

function now() {
  return new Date().toISOString()
}

function aspectRatioOf(value, stylePrompt = '') {
  if (value === '16:9' || value === '9:16') return value
  return /(?:^|\D)16\s*[:：]\s*9(?:\D|$)/.test(stylePrompt) ? '16:9' : '9:16'
}

function assertStyleRatio(stylePrompt, aspectRatio) {
  const ratios = [...String(stylePrompt || '').matchAll(/(?:^|\D)(16\s*[:：]\s*9|9\s*[:：]\s*16)(?=\D|$)/g)]
    .map(match => match[1].replace(/\s|：/g, ':'))
  if (ratios.some(ratio => ratio !== aspectRatio)) {
    fail('ASPECT_RATIO_CONFLICT', `画面风格中的画幅与已选 ${aspectRatio} 冲突，请统一后再保存`)
  }
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

function defaultPlan(input, episodeId, targetDurationSec) {
  const count = Math.max(1, Math.ceil(targetDurationSec / CHAPTER_SECONDS))
  const story = text(input.sourceText, 'sourceText')
  const style = String(input.stylePrompt || '写实电影感，人物身份、服装、场景和光线连续').trim()
  const beats = story.split(/(?<=[。！？!?；;])|\n+/).map(item => item.trim()).filter(Boolean)
  const shotLanguage = [
    ['环境建立', '稳定推进，交代人物、地点和空间关系'],
    ['人物进入', '跟随人物动作，保持视线方向和轴线一致'],
    ['矛盾出现', '缓慢靠近人物表情，突出新的叙事信息'],
    ['关系变化', '在人物互动与关键物件之间自然切换焦点'],
    ['关键选择', '动作连续并停留在决定性的表情或手势'],
    ['章节落点', '镜头缓慢拉开，以明确的新状态承接下一章'],
  ]
  const phaseLanguage = ['开端：人物进入事件并建立目标', '发展：阻力升级并迫使人物行动', '转折：新信息改变人物关系', '高潮：人物作出不可回避的选择', '结局：选择产生结果并形成新状态']
  const chapters = Array.from({ length: count }, (_, chapterIndex) => {
    const chapterId = `chapter-${String(chapterIndex + 1).padStart(2, '0')}`
    const chapterBeats = beats.filter((_, index) => index % count === chapterIndex)
    const summary = chapterBeats.join('') || beats[chapterIndex % beats.length] || story
    const phase = phaseLanguage[Math.min(phaseLanguage.length - 1, Math.floor(chapterIndex * phaseLanguage.length / count))]
    const anchors = Array.from({ length: ANCHORS_PER_CHAPTER }, (_, anchorIndex) => {
      const [purpose, motion] = shotLanguage[anchorIndex]
      const beat = chapterBeats[anchorIndex % Math.max(1, chapterBeats.length)] || summary
      return {
        id: `${chapterId}-anchor-${String(anchorIndex + 1).padStart(2, '0')}`,
        order: anchorIndex + 1,
        role: anchorIndex === 0 ? 'start' : 'continuation',
        imagePrompt: `${style}。${phase}。${purpose}：${beat}。画面必须呈现本镜头独有的动作、物件与人物状态，不要重复上一画面。`,
        motionPrompt: `${motion}；动作从“${purpose}”自然发展到下一叙事状态。`,
      }
    })
    return { id: chapterId, order: chapterIndex + 1, title: `第 ${chapterIndex + 1} 章`, summary, anchors }
  })
  return { schemaVersion: 'elysium-plan-2', episodeId, source: 'auto-draft', chapters }
}

export function validatePlan(value, episodeId) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.chapters) || value.chapters.length === 0) {
    fail('PLAN_INVALID', 'plan.chapters 至少需要一章')
  }
  const chapterIds = new Set()
  const anchorIds = new Set()
  const chapters = value.chapters.map((chapter, chapterIndex) => {
    const id = safeId(chapter.id || `chapter-${String(chapterIndex + 1).padStart(2, '0')}`, 'chapter.id')
    if (chapterIds.has(id)) fail('PLAN_INVALID', `章节 ID 重复：${id}`)
    chapterIds.add(id)
    if (!Array.isArray(chapter.anchors) || chapter.anchors.length !== ANCHORS_PER_CHAPTER) {
      fail('PLAN_INVALID', `${id} 必须正好包含 ${ANCHORS_PER_CHAPTER} 个锚点`)
    }
    const anchors = chapter.anchors.map((anchor, anchorIndex) => {
      const anchorId = safeId(anchor.id || `${id}-anchor-${String(anchorIndex + 1).padStart(2, '0')}`, 'anchor.id')
      if (anchorIds.has(anchorId)) fail('PLAN_INVALID', `锚点 ID 重复：${anchorId}`)
      anchorIds.add(anchorId)
      const expectedRole = anchorIndex === 0 ? 'start' : 'continuation'
      if (anchor.role && anchor.role !== expectedRole) fail('PLAN_INVALID', `${anchorId}.role 必须是 ${expectedRole}`)
      return {
        id: anchorId,
        order: anchorIndex + 1,
        role: expectedRole,
        imagePrompt: text(anchor.imagePrompt, `${anchorId}.imagePrompt`),
        motionPrompt: text(anchor.motionPrompt, `${anchorId}.motionPrompt`),
      }
    })
    return {
      id,
      order: chapterIndex + 1,
      title: String(chapter.title || `第 ${chapterIndex + 1} 章`).trim(),
      summary: String(chapter.summary || '').trim(),
      anchors,
    }
  })
  const normalizedPrompts = chapters.flatMap(chapter => chapter.anchors.map(anchor => anchor.imagePrompt.replace(/\s+/g, '').toLowerCase()))
  if (new Set(normalizedPrompts).size !== normalizedPrompts.length) {
    fail('PLAN_DUPLICATED', '规划中存在完全重复的画面提示，请重新规划后再生产')
  }
  const source = value.source === 'producer-agent' ? 'producer-agent' : value.source === 'auto-draft' ? 'auto-draft' : 'edited'
  return { schemaVersion: 'elysium-plan-2', episodeId, source, chapters }
}

function defaultScript(episode, plan) {
  return {
    schemaVersion: 'elysium-script-2',
    source: 'auto-draft',
    synopsis: episode.sourceText,
    scenes: plan.chapters.map(chapter => ({ id: `scene-${String(chapter.order).padStart(2, '0')}`, title: chapter.title, summary: chapter.summary || chapter.anchors.map(anchor => anchor.imagePrompt).join('\n') })),
  }
}

function defaultAssets(episode) {
  const assets = [{
    id: 'cast-main', type: 'character', name: '主要角色',
    prompt: episode.castPrompt || `${episode.sourceText}。生成主要成年角色定妆设定表：每名角色分开站立，中性背景，正面全身，清晰面部和服装细节，不要叙事场景。`,
    status: 'prompt_ready',
  }]
  if (episode.stylePrompt) assets.push({ id: 'scene-style', type: 'scene', name: '统一场景风格', prompt: episode.stylePrompt, status: 'prompt_ready' })
  return assets
}

export function hashInputs(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildTasks(episode, plan, previous = []) {
  const old = new Map(previous.map(task => [task.id, task]))
  const tasks = []
  const add = (task) => {
    const prior = old.get(task.id)
    tasks.push(prior?.inputHash === task.inputHash
      ? { ...task, ...prior, inputHash: task.inputHash }
      : { ...task, versions: [...(prior?.versions || [])] })
  }
  const castPrompt = episode.castPrompt || `${episode.sourceText}。生成主要成年角色定妆设定表：每名角色分开站立，中性背景，正面全身，清晰面部和服装细节，不要叙事场景。`
  add({
    id: 'asset:cast-main', type: 'asset', entityId: 'cast-main', dependencies: [],
    inputHash: hashInputs({ type: 'asset', castPrompt, stylePrompt: episode.stylePrompt }),
    status: 'pending', attempt: 0, maxAttempts: 2, remoteJobId: null, path: null, error: null,
  })
  for (const chapter of plan.chapters) {
    chapter.anchors.forEach((anchor, index) => {
      const type = index === 0 ? 'start_frame' : 'keyframe'
      const dependencyIds = index === 0
        ? ['asset:cast-main']
        : [`anchor:${chapter.anchors[index - 1].id}`, 'asset:cast-main']
      add({
        id: `anchor:${anchor.id}`,
        type,
        entityId: anchor.id,
        chapterId: chapter.id,
        dependencies: dependencyIds,
        inputHash: hashInputs({ type, anchor, stylePrompt: episode.stylePrompt, castPrompt: episode.castPrompt }),
        status: 'pending', attempt: 0, maxAttempts: 2, remoteJobId: null, path: null, error: null,
      })
    })
    add({
      id: `chapter:${chapter.id}`,
      type: 'chapter',
      entityId: chapter.id,
      chapterId: chapter.id,
      dependencies: chapter.anchors.map(anchor => `anchor:${anchor.id}`),
      inputHash: hashInputs({ type: 'chapter', anchors: chapter.anchors, profile: episode.profile }),
      status: 'pending', attempt: 0, maxAttempts: 2, remoteJobId: null, path: null, error: null,
    })
  }
  add({
    id: 'final', type: 'final', entityId: episode.id,
    dependencies: plan.chapters.map(chapter => `chapter:${chapter.id}`),
    inputHash: hashInputs({ type: 'final', chapters: plan.chapters.map(chapter => chapter.id), profile: episode.profile }),
    status: 'pending', attempt: 0, maxAttempts: 1, remoteJobId: null, path: null, error: null,
  })
  return tasks
}

function initialState(episode) {
  return {
    schemaVersion: 'elysium-state-2',
    episodeId: episode.id,
    status: 'ready',
    activeStage: 'story',
    authorizedAt: null,
    approval: null,
    final: null,
    createdAt: now(),
    updatedAt: now(),
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
  const targetDurationSec = Number(body.targetDurationSec || 60)
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
    if (patch.plan !== undefined) {
      loaded.plan = validatePlan(patch.plan, loaded.episode.id)
    } else if (loaded.plan.source === 'auto-draft' && ['sourceText', 'targetDurationSec', 'stylePrompt', 'castPrompt', 'aspectRatio'].some(key => patch[key] !== undefined)) {
      loaded.plan = validatePlan(defaultPlan(loaded.episode, loaded.episode.id, loaded.episode.targetDurationSec), loaded.episode.id)
      loaded.plan.source = 'auto-draft'
    }
    if (patch.script && typeof patch.script === 'object') loaded.script = { ...patch.script, source: patch.script.source || 'edited' }
    else if (loaded.script?.source === 'auto-draft' && (patch.sourceText !== undefined || patch.plan !== undefined)) loaded.script = defaultScript(loaded.episode, loaded.plan)
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
      loaded.state.status = 'ready'
      loaded.state.activeStage = 'story'
      loaded.state.approval = null
      if (loaded.tasks.find(task => task.id === 'final')?.status !== 'succeeded') loaded.state.final = null
    }
    await saveEpisode(loaded)
    return { ok: true, episode: loaded.episode, script: loaded.script, assets: loaded.assets, plan: loaded.plan, state: loaded.state, tasks: loaded.tasks, issues: loaded.issues }
  })
}

export { ANCHORS_PER_CHAPTER }
