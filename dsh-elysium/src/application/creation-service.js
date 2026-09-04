import * as path from 'node:path'
import { ElysiumError, ensureProjectExists, readJson, writeJsonAtomic } from '../infrastructure/persistence/store.js'
import {
  COMPLIANCE_KEYS,
  TOTAL_STEPS,
  applyStepValue,
  compileEpisodeInput,
  compileStoryDraft,
  confirmStepAt,
  deriveEpisodeId,
  initialCreation,
  stepAt,
  stepContext,
  storyHashOf,
  validateStepValue,
} from '../domain/creation.js'
import { now, safeId } from '../domain/episode.js'
import { DIRECTORS_VERSION, composeOpeningPrompt, findDirector, mergePlanningProfile } from './directors.js'
import { DIRECTOR_PROFILE } from './director-profile.js'
import { episodeCreate, episodeUpdate, loadEpisode } from './episode-service.js'
import { projectCreate } from './project-service.js'

/**
 * 创新项目入口的用例层：导演选择、会话绑定、15 步创作、剧情确认与制作流程同步。
 *
 * 幂等口径：
 * - 会话创建由调用方预分配 `conversationId`，`bindSession` 重复调用无副作用。
 * - 剧情确认与同步都以 `storyHash` 为幂等键；同一份剧情永远只产生一个单集。
 * - `syncToProduction` 记账在 `creation.sync`，重复调用直接返回既有结果。
 */

const locks = new Map()

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

function creationFile(projectDirectory) {
  return path.join(projectDirectory, 'creation.json')
}

/** 项目级串行化：创作记录的读改写必须成对，避免并发覆盖。 */
async function withCreationLock(projectId, operation) {
  const previous = locks.get(projectId) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  locks.set(projectId, current)
  try {
    return await current
  } finally {
    if (locks.get(projectId) === current) locks.delete(projectId)
  }
}

async function loadCreation(config, projectId) {
  const projectDirectory = await ensureProjectExists(config, safeId(projectId, 'projectId'))
  const creation = await readJson(creationFile(projectDirectory), null)
  if (!creation) fail('CREATION_NOT_FOUND', `项目没有创作记录：${projectId}`, 404)
  return { projectDirectory, creation }
}

async function saveCreation(projectDirectory, creation) {
  creation.updatedAt = now()
  await writeJsonAtomic(creationFile(projectDirectory), creation)
  return creation
}

/** 解析创作记录绑定的导演；历史版本缺失时如实上报，不静默换版本。 */
function resolveDirector(creation) {
  const { director, fallback } = findDirector(creation.directorId, creation.directorVersion)
  if (!director) fail('DIRECTOR_NOT_FOUND', `导演配置不存在：${creation.directorId}`, 404)
  return { director, fallback }
}

function assertCompliance(value, field) {
  const compliance = value && typeof value === 'object' ? value : {}
  for (const key of COMPLIANCE_KEYS) {
    if (compliance[key] !== true) fail('COMPLIANCE_REQUIRED', `${field}.${key} 必须由用户明确确认为 true`, 422)
  }
  return Object.fromEntries(COMPLIANCE_KEYS.map(key => [key, true]))
}

function stateOf(creation, director, fallback) {
  return {
    ok: true,
    creation,
    director: {
      id: director.id,
      schoolName: director.schoolName,
      inspiredBy: director.inspiredBy,
      version: director.version,
      summary: director.summary,
      styleTags: [...director.styleTags],
      emotionRhythm: { ...director.emotionRhythm },
      disclaimer: director.disclaimer,
      hardConstraints: [...director.hardConstraints],
      skill: director.skill,
    },
    directorVersionFallback: fallback,
  }
}

export function createCreationService(config = {}, planner = null) {
  const syncFlights = new Map()
  /**
   * 建项目 + 固化导演 + 初始化创作记录，一次完成。
   *
   * 返回的 `openingPrompt` 是要注入会话的开场消息（设计里的 L1 层）：提示词正文只在
   * 服务端拼装，前端拿到的是成品文本。
   */
  async function createProject(body = {}) {
    const directorId = String(body.directorId || '').trim()
    const { director } = findDirector(directorId)
    if (!director) fail('DIRECTOR_NOT_FOUND', `导演配置不存在：${directorId || '(未选择)'}`, 404)

    const created = await projectCreate(config, {
      title: body.title,
      description: body.description,
      kind: 'creative',
      directorId: director.id,
      directorVersion: director.version,
    })
    const projectDirectory = await ensureProjectExists(config, created.project.id)
    const creation = initialCreation({
      projectId: created.project.id,
      directorId: director.id,
      directorVersion: director.version,
    })
    await saveCreation(projectDirectory, creation)
    return {
      ok: true,
      project: created.project,
      creation,
      openingPrompt: composeOpeningPrompt(director, created.project, TOTAL_STEPS),
      skill: director.skill,
    }
  }

  /**
   * 把已创建的 DeepSeek 会话绑到项目。
   *
   * 幂等：同一个 conversationId 重复调用只刷新标题，不改状态；换成另一个会话 ID 则
   * 明确拒绝，避免一个项目被两条对话同时写。
   */
  async function bindSession(body = {}) {
    return withCreationLock(safeId(body.projectId, 'projectId'), async () => {
      const { projectDirectory, creation } = await loadCreation(config, body.projectId)
      const conversationId = String(body.conversationId || '').trim()
      if (!conversationId) fail('VALIDATION_ERROR', 'conversationId 不能为空')
      if (creation.conversationId && creation.conversationId !== conversationId) {
        fail('CONVERSATION_ALREADY_BOUND', '该项目已经绑定了另一条创作会话', 409)
      }
      creation.conversationId = conversationId
      creation.conversationTitle = String(body.conversationTitle || creation.conversationTitle || '').trim() || null
      if (creation.status === 'director_selected') creation.status = 'conversation_created'
      if (body.skillLoaded === true && creation.status === 'conversation_created') creation.status = 'skill_loaded'
      await saveCreation(projectDirectory, creation)

      const projectFile = path.join(projectDirectory, 'project.json')
      const project = await readJson(projectFile)
      if (project.conversationId !== conversationId) {
        await writeJsonAtomic(projectFile, { ...project, conversationId, updatedAt: now() })
      }
      const { director, fallback } = resolveDirector(creation)
      return stateOf(creation, director, fallback)
    })
  }

  /** 读取完整创作状态。Skill 每次接续前先读这里，不依赖对话记忆。 */
  async function getState(body = {}) {
    const { projectDirectory, creation } = await loadCreation(config, body.projectId)
    const { director, fallback } = resolveDirector(creation)
    const project = await readJson(path.join(projectDirectory, 'project.json'))
    return {
      ...stateOf(creation, director, fallback),
      project,
      openingPrompt: composeOpeningPrompt(director, project, TOTAL_STEPS),
      skill: director.skill,
    }
  }

  /** 保存一步的草稿结果；`expectedRevision` 不匹配时拒绝，避免多标签页互相覆盖。 */
  async function saveStep(body = {}) {
    return withCreationLock(safeId(body.projectId, 'projectId'), async () => {
      const { projectDirectory, creation } = await loadCreation(config, body.projectId)
      const { director, fallback } = resolveDirector(creation)
      if (creation.status === 'production_ready' || creation.approval) {
        fail('STORY_LOCKED', '剧情已定稿；请先调用 reopen_story 退回创作再修改', 409)
      }
      const step = stepAt(creation, body.index)
      if (body.expectedRevision !== undefined && Number(body.expectedRevision) !== step.revision) {
        fail('STALE_STEP', `第 ${step.index} 步已被更新（当前修订 ${step.revision}），请刷新后重试`, 409)
      }
      const value = validateStepValue(step.index, body.value, stepContext(creation, director))
      applyStepValue(creation, step.index, value)
      await saveCreation(projectDirectory, creation)
      return stateOf(creation, director, fallback)
    })
  }

  /** 确认一步。关键阶段（gate=user）必须由用户明确同意后才调用。 */
  async function confirmStep(body = {}) {
    return withCreationLock(safeId(body.projectId, 'projectId'), async () => {
      const { projectDirectory, creation } = await loadCreation(config, body.projectId)
      const { director, fallback } = resolveDirector(creation)
      if (creation.approval) fail('STORY_LOCKED', '剧情已定稿；请先调用 reopen_story 退回创作再修改', 409)
      confirmStepAt(creation, body.index)
      await saveCreation(projectDirectory, creation)
      return stateOf(creation, director, fallback)
    })
  }

  /** 汇总 13 步结果为结构化剧情草稿，并算出剧情指纹。 */
  async function compileStory(body = {}) {
    return withCreationLock(safeId(body.projectId, 'projectId'), async () => {
      const { projectDirectory, creation } = await loadCreation(config, body.projectId)
      const { director, fallback } = resolveDirector(creation)
      const { storyDraft, storyHash } = compileStoryDraft(creation, director)
      creation.storyDraft = storyDraft
      creation.storyHash = storyHash
      creation.storyVersion += 1
      creation.status = 'awaiting_story_approval'
      creation.currentStep = TOTAL_STEPS
      stepAt(creation, 14).status = 'confirmed'
      stepAt(creation, 14).confirmedAt = now()
      stepAt(creation, 15).status = 'draft'
      await saveCreation(projectDirectory, creation)
      return stateOf(creation, director, fallback)
    })
  }

  /**
   * 剧情定稿。
   *
   * 只从 UI 的 HTTP 路由暴露，不进聊天工具的 action 表——模型物理上无法自我批准。
   * 重复确认同一份剧情返回既有记录；剧情已变则拒绝，要求前端刷新预览。
   */
  async function approveStory(body = {}) {
    return withCreationLock(safeId(body.projectId, 'projectId'), async () => {
      const { projectDirectory, creation } = await loadCreation(config, body.projectId)
      const { director, fallback } = resolveDirector(creation)
      if (!creation.storyDraft) fail('STORY_NOT_COMPILED', '请先汇总完整剧情再确认', 409)
      const current = storyHashOf(creation.storyDraft)
      const requested = String(body.storyHash || '').trim()
      if (!requested) fail('VALIDATION_ERROR', 'storyHash 不能为空')
      if (requested !== current) {
        fail('STORY_CHANGED', '剧情在确认期间发生了变化，请刷新预览后重新确认', 409)
      }
      if (creation.approval?.storyHash === current) {
        return stateOf(creation, director, fallback)
      }
      const compliance = assertCompliance(body.compliance, 'compliance')
      creation.storyHash = current
      creation.storyDraft.confirmedAt = now()
      creation.approval = {
        storyHash: current,
        storyVersion: creation.storyVersion,
        confirmedAt: now(),
        confirmedBy: String(body.confirmedBy || '').trim() || 'user',
        compliance,
      }
      creation.status = 'story_approved'
      stepAt(creation, 15).status = 'confirmed'
      stepAt(creation, 15).confirmedAt = creation.approval.confirmedAt
      await saveCreation(projectDirectory, creation)
      return stateOf(creation, director, fallback)
    })
  }

  /**
   * 把定稿剧情幂等写入制作流程。
   *
   * 不直接手写 plan.json：剧情编译成故事文本后交给 Producer Agent 生成规划，再用剧情里的
   * 章节数与环境音提示做校验与覆盖。六锚点、去重和场景覆盖率的硬校验因此仍由既有的
   * `validatePlan` / `normalizeResult` 执行。
   *
   * 单集 ID 由**首次**同步的剧情指纹派生后固定；之后改剧情走 `episodeUpdate`，让既有的
   * 依赖失效机制保留未受影响的已付费素材。
   */
  async function performSyncToProduction(body = {}) {
    const projectId = safeId(body.projectId, 'projectId')
    const prepared = await withCreationLock(projectId, async () => {
      const { projectDirectory, creation } = await loadCreation(config, projectId)
      const { director } = resolveDirector(creation)
      if (!creation.approval) fail('STORY_NOT_APPROVED', '剧情尚未确认，不能进入制作', 409)
      const requested = String(body.storyHash || creation.storyHash || '').trim()
      if (requested !== creation.approval.storyHash) {
        fail('STORY_CHANGED', '剧情指纹与已确认的版本不一致，请重新确认后再同步', 409)
      }
      if (creation.sync.syncedStoryHash === requested && creation.sync.episodeId) {
        return { done: true, projectDirectory, creation, director }
      }
      creation.status = 'syncing_to_production'
      creation.sync.attempt += 1
      creation.sync.lastError = null
      await saveCreation(projectDirectory, creation)
      return { done: false, projectDirectory, creation, director }
    })

    const { projectDirectory, creation, director } = prepared
    if (prepared.done) {
      const { director: resolved, fallback } = resolveDirector(creation)
      return { ...stateOf(creation, resolved, fallback), episodeId: creation.sync.episodeId, reused: true }
    }
    if (!planner?.plan) fail('PLANNER_UNAVAILABLE', 'Producer Agent 未加载，无法生成分镜规划', 424)

    const draft = creation.storyDraft
    const episodeId = creation.sync.episodeId || deriveEpisodeId(creation.approval.storyHash)
    const profile = mergePlanningProfile(DIRECTOR_PROFILE, director)
    const input = compileEpisodeInput(draft, profile)
    const aspectRatio = body.aspectRatio === '16:9' ? '16:9' : '9:16'
    const episodeInput = { ...input, aspectRatio, profile: body.profile === 'final' ? 'final' : 'preview' }

    try {
      const planned = await planner.plan({ ...episodeInput, episodeId, directorProfile: profile })
      if (planned.plan.chapters.length !== draft.chapterCount) {
        fail(
          'CHAPTER_COUNT_MISMATCH',
          `规划返回 ${planned.plan.chapters.length} 章，与剧情设计的 ${draft.chapterCount} 章不一致`,
          422,
        )
      }
      // 剧情里的环境音是用户确认过的，覆盖规划的自动产出。
      planned.plan.chapters = planned.plan.chapters.map((chapter, index) => ({
        ...chapter,
        soundPrompt: draft.chapters[index]?.soundPrompt || chapter.soundPrompt,
      }))

      const exists = await loadEpisode(config, projectId, episodeId).then(() => true).catch(() => false)
      const result = exists
        ? await episodeUpdate(config, { projectId, episodeId, updates: { ...episodeInput, ...planned } })
        : await episodeCreate(config, { projectId, episodeId, ...episodeInput, ...planned })

      return withCreationLock(projectId, async () => {
        const latest = await loadCreation(config, projectId)
        latest.creation.sync = {
          episodeId,
          syncedStoryHash: creation.approval.storyHash,
          syncedAt: now(),
          attempt: latest.creation.sync.attempt,
          lastError: null,
        }
        latest.creation.status = 'production_ready'
        await saveCreation(latest.projectDirectory, latest.creation)
        const { director: resolved, fallback } = resolveDirector(latest.creation)
        return { ...stateOf(latest.creation, resolved, fallback), episodeId, reused: false, episode: result.episode }
      })
    } catch (error) {
      await withCreationLock(projectId, async () => {
        const latest = await loadCreation(config, projectId)
        latest.creation.status = 'story_approved'
        latest.creation.sync.lastError = error?.message || String(error)
        await saveCreation(latest.projectDirectory, latest.creation)
      }).catch(() => {})
      void projectDirectory
      throw error
    }
  }

  /** 同一项目的并发同步共享一次 Producer Agent 调用；落盘幂等仍由 storyHash/episodeId 保证。 */
  async function syncToProduction(body = {}) {
    const projectId = safeId(body.projectId, 'projectId')
    const active = syncFlights.get(projectId)
    if (active) return active
    const operation = performSyncToProduction(body)
    syncFlights.set(projectId, operation)
    try {
      return await operation
    } finally {
      if (syncFlights.get(projectId) === operation) syncFlights.delete(projectId)
    }
  }

  /**
   * 从定稿退回创作。
   *
   * 只改创作状态、作废剧情确认记录；不删除任何已生成产物。单集正在生产时，后续同步会被
   * `episodeUpdate` 以 EPISODE_BUSY 拒绝——调用方应先 `production.pause`。
   */
  async function reopenStory(body = {}) {
    return withCreationLock(safeId(body.projectId, 'projectId'), async () => {
      const { projectDirectory, creation } = await loadCreation(config, body.projectId)
      const { director, fallback } = resolveDirector(creation)
      if (!creation.approval) fail('STORY_NOT_APPROVED', '当前剧情不在定稿状态', 409)
      creation.approval = null
      creation.status = 'story_developing'
      creation.currentStep = Math.min(TOTAL_STEPS, 13)
      stepAt(creation, 15).status = 'pending'
      stepAt(creation, 15).confirmedAt = null
      creation.reopenReason = String(body.reason || '').trim() || null
      await saveCreation(projectDirectory, creation)
      return stateOf(creation, director, fallback)
    })
  }

  return {
    catalogVersion: DIRECTORS_VERSION,
    createProject,
    bindSession,
    getState,
    saveStep,
    confirmStep,
    compileStory,
    approveStory,
    syncToProduction,
    reopenStory,
  }
}
