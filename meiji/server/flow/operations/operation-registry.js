import { operation as images } from './generate/operation-images.js'
import { operations as projectLibrary } from './direct/operation-project-library.js'
import { operations as propText } from './direct/operation-prop-edit.js'
import { linkStore } from '../../data/workspace-links.js'
import { projectStore } from '../../data/project-store.js'
import { materialize } from '../../../shared/episode-rules.js'
import { describeTask } from '../tasks/task-registry.js'
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
import { operation as summary } from './generate/operation-summary.js'
import { sync, revise } from './generate/operation-script.js'
import { operations as scriptDirect } from './direct/operation-script.js'
import { scriptBlockers, scriptFreshness, isAiCreation } from '../../../shared/script-assembly.js'
import { operation as projectSummary } from './generate/operation-project-summary.js'
import { operation as story } from './generate/operation-story.js'
import { operation as character_image } from './generate/operation-character-image.js'
import { operation as scene_image } from './generate/operation-scene-image.js'
import { operation as prop_image } from './generate/operation-prop-image.js'
import { operation as shot_table } from './generate/operation-shot-table.js'
import { operation as seconds } from './generate/operation-seconds.js'
import { operation as film } from './generate/operation-film.js'
const direct = { ...libraryDelete, ...projectLibrary, ...propText, ...actionsEpisodeEpisodeDelete, ...actionsEpisodeEpisodeSave, ...actionsEpisodeSource, ...actionsImageClearImage, ...actionsImageImageCandidate, ...actionsImageImportImage, ...actionsImagePartImport, ...actionsImagePartText, ...actionsImageReference, ...actionsImageUseAsset, ...actionsProjectCreate, ...actionsProjectLibraryImport, ...actionsProjectOpen, ...actionsProjectOverview, ...actionsProjectProjectDelete, ...actionsReviewOverride, ...actionsShotAssemble, ...actionsShotShotAssets, ...actionsShotStoryboardText, ...actionsStoryCharacterText, ...actionsStoryOutlineText, ...actionsStoryPropDelete, ...actionsStorySceneText }
export const operations = { images, 'library-image': { label: '生成库图片', scope: 'project', lock: 'project', kind: 'generate', agent: false, tasks: () => [{ type: 'library-image' }] }, ...Object.fromEntries(Object.entries({ ...direct, ...scriptDirect }).map(([id, value]) => [id, { ...value, kind: 'direct', actor: 'human' }])), summary, 'project-summary': projectSummary, story, 'script-sync': sync, 'script-revise': revise, 'character-image': character_image, 'scene-image': scene_image, 'prop-image': prop_image, 'shot-table': shot_table, seconds, film }
export const labels = Object.fromEntries(Object.entries(operations).map(([id, value]) => [id, value.label]))
export function operationLabel(op) { return `${labels[op.action] || op.action}${op.track ? ' ' + op.track : ''}${op.only ? '·' + op.only : ''}${op.draft ? '·草稿' : ''}${op.parts ? '·' + op.parts : ''}` }
export function validateOperation(op) {
  const definition = Object.hasOwn(operations, op?.action) ? operations[op.action] : null
  if (!definition) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  if (op.origin === 'session' && !definition.agent) throw Object.assign(new Error('该操作只能由人在面板上执行'), { status: 403 })
  if (op.only && op.action !== 'story') throw new Error('only 仅用于剧情')
  if (op.parts && op.action !== 'film') throw new Error('parts 仅用于成片')
  return definition
}
export async function planningProject(home, op) {
  if (!op.projectId) return null
  const root = await projectStore(home).read(op.projectId)
  const episodeId = op.episodeId || (root.episodes.length === 1 ? root.episodes[0].id : null)
  return episodeId && operations[op.action]?.scope !== 'project' ? materialize(root, episodeId) : root
}
export async function planTasks(home, op) {
  const definition = validateOperation(op)
  if (op.sessionId && op.projectId) await linkStore(home).requireProject(op.sessionId, op.projectId)
  const project = await planningProject(home, op)
  const root = op.projectId ? await projectStore(home).read(op.projectId) : null
  if (root && ['summary', 'story', 'project-summary', 'script-revise', 'episode-add'].includes(op.action)) {
    const blockers = scriptBlockers(root).filter(item => !(op.action === 'summary' && op.episodeId && item.episodeId === op.episodeId && ['episode-sync', 'proposal'].includes(item.kind)))
    if (blockers.length) throw Object.assign(new Error('剧本有待处理回写或方案，请处理后继续'), { status: 409, code: 'SCRIPT_PENDING', blockers })
  }
  if (root && ['summary', 'episode-add'].includes(op.action) && isAiCreation(root) && !root.premise && !root.episodes.length && !String(op.requirements || op.fields?.requirements || '').trim()) throw Object.assign(new Error('首次生成请填写故事设想'), { status: 400 })
  if (project?.episodeId && !op.episodeId) op.episodeId = project.episodeId
  await definition.precheck?.(project, op)
  if ((op.origin === 'session' && op.mode === 'generate' || op.action === 'images') && definition.completed?.(project, op)) return []
  const items = definition.kind === 'direct' ? [{ type: 'save', label: definition.label }] : definition.tasks(project, op)
  if (root && ['summary', 'story'].includes(op.action) && scriptFreshness(root).summaryNeedsUpdate) items.unshift({ type: 'project-summary', params: { draft: false } })
  if (!items.length) throw new Error('没有可执行的任务')
  return items.map(item => describeTask(item, op, definition.kind === 'direct' ? definition : null, project))
}
