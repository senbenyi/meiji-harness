import { createHash } from 'node:crypto'
import { ElysiumError } from './errors.js'
import { CHAPTER_SECONDS, TARGET_MAX, TARGET_MIN, now } from './episode.js'

/**
 * 创作阶段的实体规则：15 步向导、剧情草稿编译、剧情指纹与失效传播。
 *
 * 纯逻辑，无 I/O。持久化和远端调用在 `application/creation-service.js`。
 *
 * 与单集生产状态机的关系：本状态机在 `production_ready` 交接，之后由
 * `production-service` 接管；两者各自持久化，互不覆盖。
 */

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

/** 创作状态机的全部取值。 */
export const CREATION_STATUSES = Object.freeze([
  'project_created',
  'director_selected',
  'conversation_created',
  'skill_loaded',
  'story_developing',
  'story_ready',
  'awaiting_story_approval',
  'story_approved',
  'syncing_to_production',
  'production_ready',
])

/**
 * 15 步创作流程。
 *
 * `gate: 'user'` 的步骤必须拿到用户明确同意才能确认；`'auto'` 的步骤在用户不反对时
 * 可由 Skill 直接确认。步骤顺序即依赖顺序：改第 N 步会把 N 之后所有已确认步降级。
 */
export const CREATION_STEPS = Object.freeze([
  { index: 1, key: 'goal', label: '确认作品目标', gate: 'auto' },
  { index: 2, key: 'duration', label: '确认目标时长', gate: 'auto' },
  { index: 3, key: 'intensity', label: '确认内容尺度', gate: 'user' },
  { index: 4, key: 'characters', label: '创建主要角色', gate: 'user' },
  { index: 5, key: 'relations', label: '确认人物关系', gate: 'auto' },
  { index: 6, key: 'theme', label: '确认故事主题', gate: 'auto' },
  { index: 7, key: 'conflict', label: '设计核心冲突', gate: 'user' },
  { index: 8, key: 'synopsis', label: '生成剧情梗概', gate: 'user' },
  { index: 9, key: 'scenes', label: '拆分场景', gate: 'auto' },
  { index: 10, key: 'emotionCurve', label: '设计情绪曲线', gate: 'auto' },
  { index: 11, key: 'chapters', label: '设计章节', gate: 'user' },
  { index: 12, key: 'staging', label: '设计分镜与表演', gate: 'auto' },
  { index: 13, key: 'sound', label: '设计环境音与拟音', gate: 'auto' },
  { index: 14, key: 'compile', label: '汇总完整剧情', gate: 'auto' },
  { index: 15, key: 'approval', label: '请求用户最终确认', gate: 'user' },
])

export const TOTAL_STEPS = CREATION_STEPS.length
/** 第 14 步由 compileStory 推进，第 15 步由 approveStory 推进；两者不接受 save_step。 */
const DATA_STEPS = 13
export const COMPLIANCE_KEYS = Object.freeze([
  'fictional_adults_only',
  'all_participants_18_or_older',
  'consensual_content',
  'rights_confirmed',
])

/**
 * 声音能力边界：MMAudio 合同声明 `cannot: ["speech","voice_over","music","tts"]`。
 * 任何要求对白、旁白、配音或音乐的提示词都必须在写入前被拒绝，而不是等到远端失败。
 */
const SOUND_BANNED = [
  /dialogue/i, /\bdialog\b/i, /voice[\s-]?over/i, /narration/i, /narrator/i, /monologue/i,
  /\btts\b/i, /text[\s-]?to[\s-]?speech/i, /\bspeech\b/i, /\bmusic\b/i, /\bbgm\b/i,
  /soundtrack/i, /background score/i, /\bsong\b/i, /singing/i,
  /对白/, /台词/, /旁白/, /配音/, /解说/, /音乐/, /配乐/, /歌声/, /主题曲/,
]

/**
 * 校验一段声音提示词只包含环境音与拟音。
 *
 * @param value - 提示词原文。
 * @param field - 报错时指明的字段。
 * @throws SOUND_CAPABILITY_EXCEEDED 当出现对白、旁白、配音、TTS 或音乐要求。
 */
export function assertAmbientSoundOnly(value, field) {
  const text = String(value || '')
  const hit = SOUND_BANNED.find(pattern => pattern.test(text))
  if (hit) {
    fail(
      'SOUND_CAPABILITY_EXCEEDED',
      `${field} 只能描述可听见的环境音与拟音。当前模型不生成对白、旁白、配音、TTS 或音乐，请改写后重试`,
      422,
    )
  }
  return text
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('STEP_SCHEMA_INVALID', `${field} 必须是一个对象`, 422)
  return value
}

function requireArray(value, field, min = 1) {
  if (!Array.isArray(value) || value.length < min) fail('STEP_SCHEMA_INVALID', `${field} 至少需要 ${min} 项`, 422)
  return value
}

function requireText(value, field, max = 4000) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) fail('STEP_SCHEMA_INVALID', `${field} 不能为空`, 422)
  if (text.length > max) fail('STEP_SCHEMA_INVALID', `${field} 不能超过 ${max} 个字符`, 422)
  return text
}

/** 目标时长决定章节数；创作端和 Producer Agent 用同一个公式。 */
export function chapterCountFor(durationSec) {
  return Math.max(1, Math.ceil(durationSec / CHAPTER_SECONDS))
}

function normalizeCharacter(raw, position) {
  const item = requireObject(raw, `characters[${position}]`)
  const age = Number(item.age)
  if (!Number.isInteger(age)) {
    fail('CHARACTER_AGE_REQUIRED', `characters[${position}].age 必须是具体的整数年龄，不接受「二十岁左右」这类模糊表述`, 422)
  }
  return {
    id: String(item.id || `char-${String(position + 1).padStart(2, '0')}`),
    name: requireText(item.name, `characters[${position}].name`, 60),
    age,
    gender: String(item.gender || '').trim(),
    appearance: requireText(item.appearance, `characters[${position}].appearance`),
    clothing: String(item.clothing || '').trim(),
    personality: String(item.personality || '').trim(),
  }
}

function normalizeScene(raw, position) {
  const item = requireObject(raw, `scenes[${position}]`)
  return {
    id: String(item.id || `scene-${String(position + 1).padStart(2, '0')}`),
    title: String(item.title || `第 ${position + 1} 场`).trim(),
    location: String(item.location || '').trim(),
    timeOfDay: String(item.timeOfDay || '').trim(),
    characters: Array.isArray(item.characters) ? item.characters.map(id => String(id)) : [],
    summary: requireText(item.summary, `scenes[${position}].summary`),
    dialogue: Array.isArray(item.dialogue)
      ? item.dialogue.map(line => ({ speaker: String(line?.speaker || '').trim(), line: String(line?.line || '').trim() }))
        .filter(line => line.line)
      : [],
  }
}

/**
 * 校验并归一化一步的结果。
 *
 * @param index - 步骤序号（1..13）。
 * @param value - 该步的原始结果。
 * @param context - 跨步上下文：`{ chapterCount, sceneIds, maxAdjacentDelta }`。
 * @returns 归一化后的结果。
 */
export function validateStepValue(index, value, context = {}) {
  const step = CREATION_STEPS.find(item => item.index === index)
  if (!step) fail('STEP_NOT_FOUND', `创作步骤不存在：${index}`, 404)
  if (index > DATA_STEPS) fail('STEP_NOT_WRITABLE', `第 ${index} 步由系统推进，不能直接保存`, 409)

  switch (step.key) {
    case 'goal': {
      const item = requireObject(value, 'goal')
      return {
        genre: String(item.genre || '').trim(),
        audience: String(item.audience || '').trim(),
        takeaway: requireText(item.takeaway, 'goal.takeaway'),
      }
    }
    case 'duration': {
      const item = requireObject(value, 'duration')
      const durationSec = Number(item.durationSec)
      if (!Number.isFinite(durationSec) || durationSec < TARGET_MIN || durationSec > TARGET_MAX) {
        fail('DURATION_OUT_OF_RANGE', `目标时长必须在 ${TARGET_MIN} 到 ${TARGET_MAX} 秒之间`, 422)
      }
      return { durationSec, chapterCount: chapterCountFor(durationSec) }
    }
    case 'intensity': {
      const item = requireObject(value, 'intensity')
      const compliance = requireObject(item.compliance, 'intensity.compliance')
      for (const key of COMPLIANCE_KEYS) {
        if (compliance[key] !== true) fail('COMPLIANCE_REQUIRED', `intensity.compliance.${key} 必须由用户明确确认为 true`, 422)
      }
      return {
        intensity: requireText(item.intensity, 'intensity.intensity'),
        avoidList: Array.isArray(item.avoidList) ? item.avoidList.map(text => String(text).trim()).filter(Boolean) : [],
        compliance: Object.fromEntries(COMPLIANCE_KEYS.map(key => [key, true])),
      }
    }
    case 'characters':
      return requireArray(value, 'characters').map(normalizeCharacter)
    case 'relations':
      return (Array.isArray(value) ? value : []).map((raw, position) => {
        const item = requireObject(raw, `relations[${position}]`)
        return {
          from: requireText(item.from, `relations[${position}].from`, 60),
          to: requireText(item.to, `relations[${position}].to`, 60),
          type: requireText(item.type, `relations[${position}].type`, 120),
          tension: String(item.tension || '').trim(),
        }
      })
    case 'theme': {
      const item = requireObject(value, 'theme')
      return { theme: requireText(item.theme, 'theme.theme'), logline: requireText(item.logline, 'theme.logline', 200) }
    }
    case 'conflict': {
      const item = requireObject(value, 'conflict')
      return {
        external: requireText(item.external, 'conflict.external'),
        internal: requireText(item.internal, 'conflict.internal'),
        choice: requireText(item.choice, 'conflict.choice'),
      }
    }
    case 'synopsis': {
      const item = requireObject(value, 'synopsis')
      return { synopsis: requireText(item.synopsis, 'synopsis.synopsis', 20000) }
    }
    case 'scenes':
      return requireArray(value, 'scenes').map(normalizeScene)
    case 'emotionCurve': {
      const points = requireArray(value, 'emotionCurve')
      const maxDelta = Number(context.maxAdjacentDelta) || 4
      const normalized = points.map((raw, position) => {
        const item = requireObject(raw, `emotionCurve[${position}]`)
        const intensity = Number(item.intensity)
        if (!Number.isFinite(intensity) || intensity < 0 || intensity > 10) {
          fail('STEP_SCHEMA_INVALID', `emotionCurve[${position}].intensity 必须在 0 到 10 之间`, 422)
        }
        return {
          sceneId: String(item.sceneId || `scene-${String(position + 1).padStart(2, '0')}`),
          intensity,
          emotionStart: String(item.emotionStart || '').trim(),
          emotionEnd: String(item.emotionEnd || '').trim(),
          note: String(item.note || '').trim(),
        }
      })
      normalized.forEach((point, position) => {
        if (position === 0) return
        const delta = Math.abs(point.intensity - normalized[position - 1].intensity)
        if (delta > maxDelta && !point.note) {
          fail(
            'EMOTION_DELTA_UNJUSTIFIED',
            `${point.sceneId} 与上一场的情绪落差 ${delta} 超过导演上限 ${maxDelta}，请在 note 里写明剧本依据`,
            422,
          )
        }
      })
      return normalized
    }
    case 'chapters': {
      const chapters = requireArray(value, 'chapters')
      const expected = Number(context.chapterCount)
      if (Number.isFinite(expected) && chapters.length !== expected) {
        fail('CHAPTER_COUNT_MISMATCH', `章节数必须是 ${expected}（由目标时长每章 ${CHAPTER_SECONDS} 秒决定），当前 ${chapters.length}`, 422)
      }
      const known = new Set(context.sceneIds || [])
      return chapters.map((raw, position) => {
        const item = requireObject(raw, `chapters[${position}]`)
        const sceneIds = requireArray(item.sceneIds, `chapters[${position}].sceneIds`).map(id => String(id))
        if (known.size) {
          const unknown = sceneIds.find(id => !known.has(id))
          if (unknown) fail('SCENE_REFERENCE_INVALID', `chapters[${position}].sceneIds 引用了不存在的场景：${unknown}`, 422)
        }
        return {
          id: `chapter-${String(position + 1).padStart(2, '0')}`,
          order: position + 1,
          title: String(item.title || `第 ${position + 1} 章`).trim(),
          summary: requireText(item.summary, `chapters[${position}].summary`),
          sceneIds,
        }
      })
    }
    case 'staging': {
      const expected = Number(context.chapterCount)
      const items = requireArray(value, 'staging')
      if (Number.isFinite(expected) && items.length !== expected) {
        fail('STAGING_COUNT_MISMATCH', `分镜与表演必须覆盖全部 ${expected} 章，当前 ${items.length}`, 422)
      }
      return items.map((raw, position) => {
        const item = requireObject(raw, `staging[${position}]`)
        return {
          chapterId: `chapter-${String(position + 1).padStart(2, '0')}`,
          beats: (Array.isArray(item.beats) ? item.beats : []).map(text => String(text).trim()).filter(Boolean),
          performanceNotes: (Array.isArray(item.performanceNotes) ? item.performanceNotes : []).map(text => String(text).trim()).filter(Boolean),
          continuity: item.continuity && typeof item.continuity === 'object' ? { ...item.continuity } : {},
        }
      })
    }
    case 'sound': {
      const expected = Number(context.chapterCount)
      const items = requireArray(value, 'sound')
      if (Number.isFinite(expected) && items.length !== expected) {
        fail('SOUND_COUNT_MISMATCH', `环境音必须覆盖全部 ${expected} 章，当前 ${items.length}`, 422)
      }
      return items.map((raw, position) => {
        const item = requireObject(raw, `sound[${position}]`)
        const field = `sound[${position}].soundPrompt`
        return {
          chapterId: `chapter-${String(position + 1).padStart(2, '0')}`,
          soundPrompt: assertAmbientSoundOnly(requireText(item.soundPrompt, field, 2000), field),
        }
      })
    }
    default:
      return fail('STEP_NOT_WRITABLE', `第 ${index} 步不接受直接保存`, 409)
  }
}

/** 新建一份创作记录。 */
export function initialCreation({ projectId, directorId, directorVersion }) {
  const stamp = now()
  return {
    schemaVersion: 'elysium-creation-1',
    projectId,
    directorId,
    directorVersion,
    conversationId: null,
    conversationTitle: null,
    status: 'director_selected',
    currentStep: 1,
    totalSteps: TOTAL_STEPS,
    steps: CREATION_STEPS.map(step => ({
      index: step.index,
      key: step.key,
      label: step.label,
      gate: step.gate,
      status: 'pending',
      value: null,
      revision: 0,
      updatedAt: null,
      confirmedAt: null,
    })),
    storyDraft: null,
    storyVersion: 0,
    storyHash: null,
    approval: null,
    sync: { episodeId: null, syncedStoryHash: null, syncedAt: null, attempt: 0, lastError: null },
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/** 取一步；不存在则报错。 */
export function stepAt(creation, index) {
  const step = creation.steps.find(item => item.index === Number(index))
  if (!step) fail('STEP_NOT_FOUND', `创作步骤不存在：${index}`, 404)
  return step
}

/** 已确认步骤的跨步上下文，供 `validateStepValue` 使用。 */
export function stepContext(creation, director) {
  const duration = creation.steps.find(item => item.key === 'duration')?.value
  const scenes = creation.steps.find(item => item.key === 'scenes')?.value
  return {
    chapterCount: duration?.chapterCount,
    sceneIds: Array.isArray(scenes) ? scenes.map(scene => scene.id) : [],
    maxAdjacentDelta: director?.emotionRhythm?.maxAdjacentDelta,
  }
}

/**
 * 写入一步的草稿结果，并把它之后所有已确认步降级为草稿。
 *
 * 下游步骤的内容建立在旧上游之上，上游一改就必须重新过一遍——这是设计里
 * 「改第 6 步则 7..15 回到未确认」那条纪律的实现。
 */
export function applyStepValue(creation, index, value) {
  const step = stepAt(creation, index)
  step.value = value
  step.status = 'draft'
  step.revision += 1
  step.updatedAt = now()
  step.confirmedAt = null
  for (const later of creation.steps) {
    if (later.index <= step.index) continue
    if (later.status === 'confirmed') {
      later.status = later.value === null ? 'pending' : 'draft'
      later.confirmedAt = null
    }
  }
  if (creation.storyDraft) {
    creation.storyDraft = null
    creation.storyHash = null
  }
  creation.approval = null
  creation.status = 'story_developing'
  creation.currentStep = Math.min(TOTAL_STEPS, step.index)
  creation.updatedAt = now()
  return step
}

/** 确认一步；无结果的步骤不能确认。 */
export function confirmStepAt(creation, index) {
  const step = stepAt(creation, index)
  if (step.index > DATA_STEPS) fail('STEP_NOT_WRITABLE', `第 ${index} 步由系统推进，不能手动确认`, 409)
  if (step.value === null) fail('STEP_EMPTY', `第 ${index} 步还没有结果，不能确认`, 409)
  step.status = 'confirmed'
  step.confirmedAt = now()
  creation.currentStep = Math.min(TOTAL_STEPS, step.index + 1)
  creation.status = 'story_developing'
  creation.updatedAt = now()
  return step
}

/** 未确认的数据步骤序号列表。 */
export function unconfirmedSteps(creation) {
  return creation.steps.filter(step => step.index <= DATA_STEPS && step.status !== 'confirmed').map(step => step.index)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

/**
 * 剧情指纹：全链路的幂等键。
 *
 * 规范化会去掉与内容无关的字段（确认时间、版本号），因此同一份剧情内容永远得到
 * 同一个 hash，与保存次数无关。
 */
export function storyHashOf(draft) {
  const { confirmedAt: _confirmedAt, storyVersion: _storyVersion, ...content } = draft
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex')}`
}

/** 由剧情指纹推导单集 ID；同一份剧情永远推导出同一个 ID。 */
export function deriveEpisodeId(storyHash) {
  return `episode-${storyHash.replace(/^sha256:/, '').slice(0, 12)}`
}

/**
 * 把 13 步结果编译成结构化剧情草稿。
 *
 * @param creation - 创作记录。
 * @param director - 已解析的导演。
 * @returns `{ storyDraft, storyHash }`。
 * @throws STEP_INCOMPLETE 当仍有未确认的数据步骤。
 */
export function compileStoryDraft(creation, director) {
  const missing = unconfirmedSteps(creation)
  if (missing.length) {
    fail('STEP_INCOMPLETE', `以下步骤尚未确认：${missing.join('、')}`, 409)
  }
  const read = key => creation.steps.find(step => step.key === key).value
  const duration = read('duration')
  const chapters = read('chapters')
  const staging = read('staging')
  const sound = read('sound')
  const stagingById = new Map(staging.map(item => [item.chapterId, item]))
  const soundById = new Map(sound.map(item => [item.chapterId, item]))

  const draft = {
    schemaVersion: 'elysium-story-1',
    projectId: creation.projectId,
    directorId: creation.directorId,
    directorVersion: creation.directorVersion,
    conversationId: creation.conversationId,
    goal: read('goal'),
    theme: read('theme').theme,
    logline: read('theme').logline,
    synopsis: read('synopsis').synopsis,
    durationSec: duration.durationSec,
    chapterCount: duration.chapterCount,
    intensity: read('intensity').intensity,
    avoidList: read('intensity').avoidList,
    characters: read('characters'),
    relations: read('relations'),
    conflict: read('conflict'),
    scenes: read('scenes'),
    emotionCurve: read('emotionCurve'),
    chapters: chapters.map(chapter => ({
      ...chapter,
      beats: stagingById.get(chapter.id)?.beats || [],
      performanceNotes: stagingById.get(chapter.id)?.performanceNotes || [],
      continuity: stagingById.get(chapter.id)?.continuity || {},
      soundPrompt: soundById.get(chapter.id)?.soundPrompt || '',
    })),
    directorNotes: director ? `${director.schoolName}：${director.emotionRhythm.curve}` : '',
    compliance: read('intensity').compliance,
    confirmedAt: null,
  }
  for (const chapter of draft.chapters) {
    assertAmbientSoundOnly(chapter.soundPrompt, `${chapter.id}.soundPrompt`)
  }
  return { storyDraft: draft, storyHash: storyHashOf(draft) }
}

/**
 * 把剧情草稿编译成单集输入。
 *
 * `sourceText` 要让 Producer Agent 能独立读懂整个故事：梗概 + 逐场剧情 + 对白。
 */
export function compileEpisodeInput(draft, profile) {
  const cast = draft.characters
    .map(character => `${character.name}：${character.age}岁${character.gender || ''}，${character.appearance}${character.clothing ? `，${character.clothing}` : ''}`)
    .join('；')
  const scenes = draft.scenes.map((scene, index) => {
    const head = `第 ${index + 1} 场 · ${scene.title}（${scene.location || '未指定地点'}／${scene.timeOfDay || '未指定时段'}）`
    const dialogue = scene.dialogue.map(line => `${line.speaker}：${line.line}`).join('\n')
    return dialogue ? `${head}\n${scene.summary}\n${dialogue}` : `${head}\n${scene.summary}`
  }).join('\n\n')
  const sourceText = [
    draft.synopsis,
    '',
    `【核心冲突】外部：${draft.conflict.external}；内部：${draft.conflict.internal}；抉择：${draft.conflict.choice}`,
    `【人物】${cast}`,
    '',
    scenes,
  ].join('\n')

  return {
    title: draft.logline.slice(0, 120),
    sourceText,
    targetDurationSec: draft.durationSec,
    stylePrompt: [profile?.style?.genre, profile?.style?.visualTone, profile?.style?.lighting].filter(Boolean).join('，'),
    castPrompt: `${cast}。生成全部成年角色的定妆设定表：每名角色分开站立，中性背景，正面全身，固定外貌与服装，不要叙事场景。`,
    negativePrompt: profile?.consistency?.negativePromptBase || '',
    compliance: { ...draft.compliance },
  }
}
