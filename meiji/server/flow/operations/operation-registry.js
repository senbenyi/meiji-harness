import { operation as images } from './generate/operation-generate-images.js'
import { operations as projectLibrary } from './direct/operation-project-library.js'
import { operations as propText } from './direct/operation-prop-edit.js'
import { operations as actionsEpisodeEpisodeDelete } from './direct/operation-episode-delete.js'
import { operations as actionsEpisodeEpisodeSave } from './direct/operation-episode-save.js'
import { operations as actionsEpisodeSource } from './direct/operation-source-edit.js'
import { operations as actionsImageClearImage } from './direct/operation-image-clear.js'
import { operations as actionsImageImageCandidate } from './direct/operation-image-candidate.js'
import { operations as actionsImageImportImage } from './direct/operation-image-import.js'
import { operations as actionsImagePartImport } from './direct/operation-image-part-import.js'
import { operations as actionsImagePartText } from './direct/operation-image-part-text.js'
import { operations as actionsImageReference } from './direct/operation-image-reference.js'
import { operations as actionsImageUseAsset } from './direct/operation-image-use-asset.js'
import { operations as actionsProjectCreate } from './direct/operation-project-create.js'
import { operations as actionsProjectLibraryImport } from './direct/operation-library-import.js'
import { operations as libraryDelete } from './direct/operation-library-delete.js'
import { operations as actionsProjectOpen } from './direct/operation-project-open.js'
import { operations as actionsProjectOverview } from './direct/operation-project-overview.js'
import { operations as actionsProjectProjectDelete } from './direct/operation-project-delete.js'
import { operations as actionsReviewOverride } from './direct/operation-review-override.js'
import { operations as actionsShotAssemble } from './direct/operation-assemble.js'
import { operations as actionsShotShotAssets } from './direct/operation-shot-assets.js'
import { operations as actionsShotStoryboardText } from './direct/operation-storyboard-edit.js'
import { operations as actionsStoryCharacterText } from './direct/operation-character-edit.js'
import { operations as actionsStoryOutlineText } from './direct/operation-outline-edit.js'
import { operations as actionsStoryPropDelete } from './direct/operation-prop-delete.js'
import { operations as actionsStorySceneText } from './direct/operation-scene-edit.js'
import { operation as summary } from './generate/operation-generate-summary.js'
import { operation as sync } from './generate/operation-sync-script.js'
import { operation as revise } from './generate/operation-revise-script.js'
import { operations as scriptDirect } from './direct/operation-script.js'
import { operation as projectSummary } from './generate/operation-update-project-summary.js'
import { operation as story } from './generate/operation-generate-story.js'
import { operation as character_image } from './generate/operation-character-image.js'
import { operation as scene_image } from './generate/operation-scene-image.js'
import { operation as prop_image } from './generate/operation-prop-image.js'
import { operation as shot_table } from './generate/operation-generate-shot-table.js'
import { operation as seconds } from './generate/operation-generate-seconds.js'
import { operation as film } from './generate/operation-generate-film.js'
import { textStepTarget, requireStepContent } from '../../../shared/text-step-target.js'
import { linkStore } from '../../data/workspace-links.js'
import { projectStore } from '../../data/project-store.js'
import { materialize } from '../../../shared/episode-rules.js'
import { describeTask } from '../tasks/task-registry.js'
import { scriptBlockers, scriptFreshness, isAiCreation } from '../../../shared/script-assembly.js'
const direct = { ...libraryDelete, ...projectLibrary, ...propText, ...actionsEpisodeEpisodeDelete, ...actionsEpisodeEpisodeSave, ...actionsEpisodeSource, ...actionsImageClearImage, ...actionsImageImageCandidate, ...actionsImageImportImage, ...actionsImagePartImport, ...actionsImagePartText, ...actionsImageReference, ...actionsImageUseAsset, ...actionsProjectCreate, ...actionsProjectLibraryImport, ...actionsProjectOpen, ...actionsProjectOverview, ...actionsProjectProjectDelete, ...actionsReviewOverride, ...actionsShotAssemble, ...actionsShotShotAssets, ...actionsShotStoryboardText, ...actionsStoryCharacterText, ...actionsStoryOutlineText, ...actionsStoryPropDelete, ...actionsStorySceneText }
export const operations = { images, 'library-image': { label: '生成库图片', scope: 'project', lock: 'project', kind: 'generate', agent: false, tasks: () => [{ type: 'library-image' }] }, ...Object.fromEntries(Object.entries({ ...direct, ...scriptDirect }).map(([id, value]) => [id, { ...value, kind: 'direct', actor: 'human' }])), summary, 'project-summary': projectSummary, story, 'script-sync': sync, 'script-revise': revise, 'character-image': character_image, 'scene-image': scene_image, 'prop-image': prop_image, 'shot-table': shot_table, seconds, film }
export const labels = Object.fromEntries(Object.entries(operations).map(([id, value]) => [id, value.label]))
export function operationLabel(op) { return `${labels[op.action] || op.action}${op.track ? ' ' + op.track : ''}${op.only ? '·' + op.only : ''}${op.draft ? '·草稿' : ''}${op.parts ? '·' + op.parts : ''}` }
export function validateOperation(op) {
  const definition = Object.hasOwn(operations, op?.action) ? operations[op.action] : null
  if (!definition) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  if (op.origin === 'session' && !definition.agent) throw Object.assign(new Error('该操作只能由人在面板上执行'), { status: 403 })
  if (op.origin === 'session' && definition.session?.stepwise) {
    if (!definition.session.modes.includes(op.mode)) throw new Error('请指定生成、重新生成、修改或审核模式')
    for (const key of definition.session.required || []) if (!op[key]) throw new Error(`会话单步操作必须指定 ${key}`)
    op.step = op.mode === 'review' ? 'review' : op.mode === 'modify' ? 'revise' : 'generate'
  } else if (op.step) throw new Error('该操作不支持独立文本步骤')
  if (op.only && op.action !== 'story') throw new Error('only 仅用于剧情')
  if (op.parts && op.action !== 'film') throw new Error('parts 仅用于成片')
  return definition
}

// 保留旧测试与历史插件的规划入口；生产入口已统一走 Run planner。
export async function planningProject(home, op) {
  if (!op.projectId) return null
  const root = await projectStore(home).read(op.projectId)
  const episodeId = op.episodeId || (root.episodes.length === 1 ? root.episodes[0].id : null)
  return episodeId && operations[op.action]?.scope !== 'project' ? materialize(root, episodeId) : root
}

export async function planTasks(home, op) {
  if (op.sessionId && op.projectId && !(op.origin === 'panel' && op.action === 'project-delete')) await linkStore(home).requireProject(op.sessionId, op.projectId)
  const definition = validateOperation(op)
  const project = await planningProject(home, op)
  const root = op.projectId ? await projectStore(home).read(op.projectId) : null
  if (root && op.step !== 'review' && ['summary', 'story', 'project-summary', 'script-revise', 'episode-add'].includes(op.action)) {
    const blockers = scriptBlockers(root).filter(item => !(op.action === 'summary' && op.episodeId && item.episodeId === op.episodeId && ['episode-sync', 'proposal'].includes(item.kind)))
    if (blockers.length) throw Object.assign(new Error('剧本有待处理回写或方案，请处理后继续'), { status: 409, code: 'SCRIPT_PENDING', blockers })
  }
  if (root && ['summary', 'episode-add'].includes(op.action) && isAiCreation(root) && !root.premise?.trim()) throw Object.assign(new Error('请先填写自由模式的 AI 创作方向'), { status: 400 })
  if (project?.episodeId && !op.episodeId) op.episodeId = project.episodeId
  if (op.step === 'review' || op.step === 'revise') requireStepContent(project, textStepTarget(op), op.episodeId)
  if (op.step !== 'review') await definition.precheck?.(project, op)
  if ((op.origin === 'session' && op.mode === 'generate' || op.action === 'images') && definition.completed?.(project, op)) return []
  const items = definition.kind === 'direct' ? [{ type: 'save', label: definition.label }] : definition.tasks(project, op)
  if (root && op.step !== 'review' && ['summary', 'story'].includes(op.action) && scriptFreshness(root).summaryNeedsUpdate) {
    if (op.step) throw Object.assign(new Error('项目摘要需要更新并审核；请先确认该前置步骤在本次目标范围内'), { code: 'PROJECT_SUMMARY_REQUIRED', status: 409 })
    items.unshift({ type: 'project-summary', params: { draft: false } })
  }
  if (!items.length) throw new Error('没有可执行的任务')
  return items.map(item => describeTask(item, op, definition.kind === 'direct' ? definition : null, project))
}
