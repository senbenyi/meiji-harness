/**
 * 生产清单：一次生产请求的唯一事实源。纯逻辑无 I/O。
 *
 * 上游依据 docs/ai-native-factory-rollout.md §3 P0-3 与 §8：创作草稿、生产任务、
 * 审阅页都引用 manifest 的版本与 hash，不允许 creation state 与 episode state
 * 各自表达"当前剧情"。
 *
 * storyHash 与 manifestVersion 是所有状态转换的幂等键：故事没变就不换版本，
 * 重复确认因此不会重复建章节或重生成已通过的资产。
 */
import { ElysiumError } from './errors.js'
import { hashInputs, now } from './episode.js'

export const MANIFEST_SCHEMA_VERSION = 'elysium-manifest-1'

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

/** 只覆盖语义内容：改提示词或结构会换 hash，改任务状态不会。 */
function storyPayload(manifest) {
  return {
    intent: manifest.intent,
    directorStyle: manifest.directorStyle,
    characters: manifest.characters,
    scenes: manifest.scenes,
    shots: manifest.shots,
  }
}

export function storyHashOf(manifest) {
  return hashInputs(storyPayload(manifest))
}

/**
 * 从既有 episode/plan/assets/tasks 派生 manifest。
 *
 * 传入 previous 时按 storyHash 决定是否换版本：故事未变则保留 manifestId 与
 * manifestVersion，让重复提交天然幂等。
 */
export function manifestFromEpisode({ projectId, episode, plan, assets = [], tasks = [], state = null, previous = null }) {
  if (!projectId) fail('VALIDATION_ERROR', 'projectId 必填')
  if (!episode?.id) fail('VALIDATION_ERROR', 'episode.id 必填')
  if (!Array.isArray(plan?.chapters) || plan.chapters.length === 0) {
    fail('PLAN_INVALID', 'plan.chapters 至少需要一章')
  }

  const scenes = plan.chapters.map(chapter => ({
    id: chapter.id,
    order: chapter.order,
    title: chapter.title,
    summary: chapter.summary,
    soundPrompt: chapter.soundPrompt || null,
  }))
  const shots = plan.chapters.flatMap(chapter => (chapter.anchors || []).map(anchor => ({
    id: anchor.id,
    sceneId: chapter.id,
    order: anchor.order,
    role: anchor.role,
    imagePrompt: anchor.imagePrompt,
    motionPrompt: anchor.motionPrompt,
  })))

  const draft = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    projectId,
    episodeId: episode.id,
    intent: {
      sourceText: episode.sourceText,
      targetDurationSec: episode.targetDurationSec,
      aspectRatio: episode.aspectRatio,
    },
    directorStyle: {
      stylePrompt: episode.stylePrompt || null,
      castPrompt: episode.castPrompt || null,
      negativePrompt: episode.negativePrompt || null,
    },
    characters: assets.map(asset => ({ id: asset.id, type: asset.type, name: asset.name, prompt: asset.prompt })),
    scenes,
    shots,
  }

  const storyHash = storyHashOf(draft)
  const unchanged = previous && previous.storyHash === storyHash
  return {
    ...draft,
    manifestId: unchanged ? previous.manifestId : `manifest-${storyHash.slice(0, 16)}`,
    manifestVersion: unchanged ? previous.manifestVersion : (previous?.manifestVersion || 0) + 1,
    storyHash,
    // 依赖拓扑照搬既有任务图，不在 manifest 里另建一套调度语义。
    capabilityPlan: tasks.map(task => ({
      taskId: task.id,
      type: task.type,
      entityId: task.entityId ?? null,
      dependsOn: [...(task.dependencies || [])],
      inputHash: task.inputHash ?? null,
    })),
    qcPolicy: {
      // 技术判据由闸门契约决定，这里只记录采用的版本与重试预算。
      maxAttempts: tasks[0]?.maxAttempts ?? 3,
      semanticEnabled: false,
    },
    consent: {
      compliance: episode.compliance ?? null,
      authorizedAt: state?.authorizedAt ?? null,
    },
    createdAt: unchanged ? previous.createdAt : now(),
    updatedAt: now(),
  }
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object') fail('MANIFEST_INVALID', 'manifest 必须是对象')
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail('MANIFEST_SCHEMA_MISMATCH', `不支持的 manifest 版本：${value.schemaVersion}`)
  }
  for (const field of ['manifestId', 'storyHash', 'projectId', 'episodeId']) {
    if (!value[field]) fail('MANIFEST_INVALID', `manifest.${field} 必填`)
  }
  if (!Number.isInteger(value.manifestVersion) || value.manifestVersion < 1) {
    fail('MANIFEST_INVALID', 'manifest.manifestVersion 必须是正整数')
  }
  if (!Array.isArray(value.scenes) || value.scenes.length === 0) fail('MANIFEST_INVALID', 'manifest.scenes 不能为空')
  if (!Array.isArray(value.shots) || value.shots.length === 0) fail('MANIFEST_INVALID', 'manifest.shots 不能为空')
  const sceneIds = new Set(value.scenes.map(scene => scene.id))
  for (const shot of value.shots) {
    if (!sceneIds.has(shot.sceneId)) fail('MANIFEST_INVALID', `镜头 ${shot.id} 指向不存在的场景 ${shot.sceneId}`)
  }
  if (storyHashOf(value) !== value.storyHash) {
    fail('MANIFEST_HASH_MISMATCH', 'manifest.storyHash 与内容不一致，manifest 已被篡改或部分更新')
  }
  return value
}
