import { createHash } from 'node:crypto'
import { ElysiumError } from './errors.js'

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const TARGET_MIN = 20
export const TARGET_MAX = 600
export const CHAPTER_SECONDS = 20
export const ANCHORS_PER_CHAPTER = 6

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

export function safeId(value, field) {
  const id = String(value || '').trim()
  if (!ID_PATTERN.test(id)) fail('VALIDATION_ERROR', `${field} 只允许小写字母、数字和连字符`)
  return id
}

export function text(value, field, max = 10000) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) fail('VALIDATION_ERROR', `${field} 不能为空`)
  if (result.length > max) fail('VALIDATION_ERROR', `${field} 不能超过 ${max} 个字符`)
  return result
}

export function now() {
  return new Date().toISOString()
}

export function aspectRatioOf(value, stylePrompt = '') {
  if (value === '16:9' || value === '9:16') return value
  return /(?:^|\D)16\s*[:：]\s*9(?:\D|$)/.test(stylePrompt) ? '16:9' : '9:16'
}

export function assertStyleRatio(stylePrompt, aspectRatio) {
  const ratios = [...String(stylePrompt || '').matchAll(/(?:^|\D)(16\s*[:：]\s*9|9\s*[:：]\s*16)(?=\D|$)/g)]
    .map(match => match[1].replace(/\s|：/g, ':'))
  if (ratios.some(ratio => ratio !== aspectRatio)) {
    fail('ASPECT_RATIO_CONFLICT', `画面风格中的画幅与已选 ${aspectRatio} 冲突，请统一后再保存`)
  }
}

export function defaultPlan(input, episodeId, targetDurationSec) {
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

export function defaultScript(episode, plan) {
  return {
    schemaVersion: 'elysium-script-2',
    source: 'auto-draft',
    synopsis: episode.sourceText,
    scenes: plan.chapters.map(chapter => ({ id: `scene-${String(chapter.order).padStart(2, '0')}`, title: chapter.title, summary: chapter.summary || chapter.anchors.map(anchor => anchor.imagePrompt).join('\n') })),
  }
}

export function defaultAssets(episode) {
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

export function initialState(episode) {
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
