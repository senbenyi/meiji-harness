/**
 * 一句话入口。
 *
 * 上游 ai-native-factory-rollout.md §4：用户只给一句话，其余由 Agent 推断；
 * 只有两处允许打断用户——内容授权与最终验收。
 *
 * 本服务是**编排的薄层**：规划仍走 Producer Agent，生产仍走既有的依赖调度与恢复，
 * 这里只负责"把一句话变成一次可追踪的生产"，并把章节/锚点/种子这些术语挡在外面。
 */
import * as path from 'node:path'
import { ElysiumError } from '../domain/errors.js'
import { manifestFromEpisode, validateManifest } from '../domain/production-manifest.js'
import { describeState } from '../domain/production-state.js'
import { readJson, writeJsonAtomic } from '../infrastructure/persistence/store.js'
import { episodeCreate, loadEpisode } from './episode-service.js'
import { projectCreate } from './project-service.js'

const DEFAULT_DURATION_SEC = 20
const ONELINE_EPISODE_ID = 'episode-01'

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

function manifestPathOf(loaded) {
  return path.join(loaded.p.dir, 'manifest.json')
}

/** 从一句话推一个项目名，不要求用户再想标题。 */
function titleFrom(sourceText) {
  const trimmed = String(sourceText || '').trim().replace(/\s+/g, ' ')
  const head = trimmed.split(/[。！？!?.;；,，]/)[0] || trimmed
  return (head.slice(0, 24) || '未命名短剧').trim()
}

/** 只透出用户看得懂的东西：能看的画面、能看的片子、要不要他做决定。 */
function previewsOf(loaded) {
  const artifacts = loaded.tasks
    .filter(task => task.status === 'succeeded' && task.path)
    .map(task => ({
      id: task.id,
      kind: ['chapter', 'final', 'audio'].includes(task.type) ? 'video' : 'image',
      path: task.path,
      // 重做单个镜头要用它，用户看到的是"重做这一镜"，不是任务 id。
      redoable: ['start_frame', 'chapter'].includes(task.type),
    }))
  return {
    artifacts,
    final: loaded.state.final?.path || null,
  }
}

export function createOnelineService(config, planner, production) {
  async function persistManifest(projectId, episodeId) {
    const loaded = await loadEpisode(config, projectId, episodeId)
    const previous = await readJson(manifestPathOf(loaded), null).catch(() => null)
    const manifest = manifestFromEpisode({
      projectId,
      episode: loaded.episode,
      plan: loaded.plan,
      assets: loaded.assets,
      tasks: loaded.tasks,
      state: loaded.state,
      previous,
    })
    validateManifest(manifest)
    await writeJsonAtomic(manifestPathOf(loaded), manifest)
    return manifest
  }

  /**
   * 提交一句话。
   *
   * 未给授权时只建草稿不开工——授权是两处必要人工确认之一，不能由模型代劳。
   */
  async function submit(body = {}) {
    const sourceText = String(body.sourceText || '').trim()
    if (!sourceText) fail('VALIDATION_ERROR', '请给出一句话描述')
    const targetDurationSec = Number(body.targetDurationSec || DEFAULT_DURATION_SEC)
    const episodeId = String(body.episodeId || ONELINE_EPISODE_ID)

    let projectId = body.projectId ? String(body.projectId) : ''
    if (!projectId) {
      const created = await projectCreate(config, { title: titleFrom(sourceText) })
      projectId = created.project?.id || created.projectId
      if (!projectId) fail('PROJECT_CREATE_FAILED', '创建项目失败', 500)
    }

    // 规划：Producer Agent 把一句话变成章节与锚点，用户不需要理解这两个词。
    const planned = await planner.plan({ sourceText, targetDurationSec, episodeId, projectId })
    await episodeCreate(config, {
      projectId, episodeId, title: titleFrom(sourceText),
      sourceText, targetDurationSec, ...planned,
    })
    const manifest = await persistManifest(projectId, episodeId)

    if (body.confirmAuthorizedContent !== true) {
      const loaded = await loadEpisode(config, projectId, episodeId)
      return {
        ok: true, projectId, episodeId,
        manifestId: manifest.manifestId,
        manifestVersion: manifest.manifestVersion,
        ...describeState(loaded.state, loaded.plan, loaded.tasks),
        needsUser: 'consent',
        message: '规划已就绪。确认内容授权后即可开始生产。',
      }
    }

    await production.start({ ...body, projectId, episodeId, confirmAuthorizedContent: true })
    const loaded = await loadEpisode(config, projectId, episodeId)
    return {
      ok: true, projectId, episodeId,
      manifestId: manifest.manifestId,
      manifestVersion: manifest.manifestVersion,
      ...describeState(loaded.state, loaded.plan, loaded.tasks),
    }
  }

  /** 授权并开工。重复调用幂等：manifest 版本不变，已通过的资产不重生成。 */
  async function authorize(body = {}) {
    if (body.confirmAuthorizedContent !== true) {
      fail('AUTHORIZATION_REQUIRED', '必须明确确认内容授权')
    }
    await production.start({ ...body, confirmAuthorizedContent: true })
    const manifest = await persistManifest(body.projectId, body.episodeId)
    const loaded = await loadEpisode(config, body.projectId, body.episodeId)
    return {
      ok: true,
      manifestId: manifest.manifestId,
      manifestVersion: manifest.manifestVersion,
      ...describeState(loaded.state, loaded.plan, loaded.tasks),
    }
  }

  async function status(body = {}) {
    const loaded = await loadEpisode(config, body.projectId, body.episodeId)
    const manifest = await readJson(manifestPathOf(loaded), null).catch(() => null)
    return {
      ok: true,
      projectId: body.projectId,
      episodeId: body.episodeId,
      manifestId: manifest?.manifestId || null,
      manifestVersion: manifest?.manifestVersion || null,
      ...describeState(loaded.state, loaded.plan, loaded.tasks),
      ...previewsOf(loaded),
      // 只在系统确实处理不了时才让用户看到问题清单。
      issues: loaded.state.status === 'needs_attention'
        ? loaded.issues.filter(issue => issue.status === 'open').map(issue => ({
          taskId: issue.taskId, code: issue.code, message: issue.message,
        }))
        : [],
    }
  }

  /** 重做单个镜头。只让受影响的下游失效，已通过的资产保留。 */
  async function redo(body = {}) {
    const taskId = String(body.taskId || '').trim()
    if (!taskId) fail('VALIDATION_ERROR', '请指定要重做的镜头')
    await production.retry({ projectId: body.projectId, episodeId: body.episodeId, taskId })
    const loaded = await loadEpisode(config, body.projectId, body.episodeId)
    return { ok: true, ...describeState(loaded.state, loaded.plan, loaded.tasks) }
  }

  /**
   * 最终验收。只经 HTTP 路由暴露，**不进聊天工具的 action 表**——
   * 否则模型可以自我批准，人工终审就名存实亡。
   */
  async function approve(body = {}) {
    const result = await production.approve(body)
    const loaded = await loadEpisode(config, body.projectId, body.episodeId)
    return { ...result, ...describeState(loaded.state, loaded.plan, loaded.tasks) }
  }

  return { submit, authorize, status, redo, approve, persistManifest }
}
