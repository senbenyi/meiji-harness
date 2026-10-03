// 操作定义：每个操作（按钮或会话工具）做什么。操作只存在于代码中，每次执行生成一个任务。
//   label  显示名称
//   scope  作用范围：project / episode / shot（决定是否需要剧集作用域，以及与哪些任务冲突）
//   queue  队列类别：text / image / video（只有调用图片或视频接口的操作占用 image / video 名额）
//   plan   根据当前项目生成步骤计划 [{ kind, target }]，步骤由处理函数经 runStep 执行
//   step   没有 plan 的操作整体作为一个步骤由执行入口执行：返回 { kind, target }，默认 execute
//   agent  会话工具（agent）能否发起；人工专属操作为 false
//   task   能否经任务管理启动（排队执行）；false 的操作只能由面板直接执行
import { projectStore } from '../../data/project-store.js'
import { materialize } from '../../../shared/episode-rules.js'
import { operations as tasksAssetImage } from './tasks/asset-image.js'
import { operations as tasksEpisodeStory } from './tasks/episode-story.js'
import { operations as tasksEpisodeSummary } from './tasks/episode-summary.js'
import { operations as tasksFilmStoryboard } from './tasks/film-storyboard.js'
import { operations as tasksFilmVideo } from './tasks/film-video.js'
import { operations as tasksFilm } from './tasks/film.js'
import { operations as tasksPencil } from './tasks/pencil.js'
import { operations as tasksSeconds } from './tasks/seconds.js'
import { operations as tasksShotSeconds } from './tasks/shot-seconds.js'
import { operations as tasksShotTable } from './tasks/shot-table.js'
import { operations as tasksStoryCharacters } from './tasks/story-characters.js'
import { operations as tasksStoryProps } from './tasks/story-props.js'
import { operations as tasksStoryScenes } from './tasks/story-scenes.js'
import { operations as actionsEpisodeEpisodeDelete } from './direct/operation-episode-delete.js'
import { operations as actionsEpisodeEpisodeSave } from './direct/operation-episode-save.js'
import { operations as actionsEpisodeSource } from './direct/operation-source-edit.js'
import { operations as actionsImageClearImage } from './direct/operation-image-clear.js'
import { operations as actionsImageClearReference } from './direct/operation-image-clear-reference.js'
import { operations as actionsImageImageCandidate } from './direct/operation-image-candidate.js'
import { operations as actionsImageImportImage } from './direct/operation-image-import.js'
import { operations as actionsImagePartImport } from './direct/operation-image-part-import.js'
import { operations as actionsImagePartText } from './direct/operation-image-part-text.js'
import { operations as actionsImageSetReference } from './direct/operation-image-set-reference.js'
import { operations as actionsImageUseAsset } from './direct/operation-image-use-asset.js'
import { operations as actionsProjectCreate } from './direct/operation-project-create.js'
import { operations as actionsProjectLibraryImport } from './direct/operation-library-import.js'
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

// 操作定义分布在 tasks/ 与 direct/ 下的独立文件中，这里汇总：每个 action 只在一个文件中定义。
export const tasks = { ...tasksAssetImage, ...tasksEpisodeStory, ...tasksEpisodeSummary, ...tasksFilmStoryboard, ...tasksFilmVideo, ...tasksFilm, ...tasksPencil, ...tasksSeconds, ...tasksShotSeconds, ...tasksShotTable, ...tasksStoryCharacters, ...tasksStoryProps, ...tasksStoryScenes }
export const actions = { ...actionsEpisodeEpisodeDelete, ...actionsEpisodeEpisodeSave, ...actionsEpisodeSource, ...actionsImageClearImage, ...actionsImageClearReference, ...actionsImageImageCandidate, ...actionsImageImportImage, ...actionsImagePartImport, ...actionsImagePartText, ...actionsImageSetReference, ...actionsImageUseAsset, ...actionsProjectCreate, ...actionsProjectLibraryImport, ...actionsProjectOpen, ...actionsProjectOverview, ...actionsProjectProjectDelete, ...actionsReviewOverride, ...actionsShotAssemble, ...actionsShotShotAssets, ...actionsShotStoryboardText, ...actionsStoryCharacterText, ...actionsStoryOutlineText, ...actionsStoryPropDelete, ...actionsStorySceneText }
export const operations = { ...tasks, ...actions }
export const definitions = operations

export const labels = Object.fromEntries(Object.entries(definitions).map(([action, value]) => [action, value.label]))
// 需要剧集作用域的操作（剧集级与镜头级；项目级和一键成片类自行读取剧集）。
export const episodeScoped = new Set(Object.entries(definitions).filter(([action, value]) => value.scope !== 'project' && !['episode-delete', 'produce', 'produce-all'].includes(action)).map(([action]) => action))

export const queueOf = action => definitions[action]?.queue || 'text'

export function operationLabel(operation) { return `${labels[operation.action] || operation.action}${operation.track ? ' ' + operation.track : ''}${operation.generationMode ? '·' + (operation.generationMode === 'modify' ? '按意见修改' : '重新生成') : ''}` }

export function validateOperation(input) {
  if (input?.action === 'shot-seconds') throw Object.assign(new Error('每秒指令请从卡片集顶部统一提交'), { status: 400 })
  if (!Object.hasOwn(definitions, input?.action)) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  const definition = definitions[input.action]
  // 人工专属操作（忽略自审、确认图片、编辑与删除等）不允许由会话工具发起。
  if (input.origin === 'session' && definition.agent !== true) throw Object.assign(new Error('该操作只能由人在面板上执行'), { status: 403 })
  if (definition.task === false) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
}

// 没有 plan 的操作由执行入口整体作为一个步骤执行；有 plan 的操作返回 null（步骤由处理函数执行）。
export function runnerStep(operation) {
  const definition = definitions[operation.action]
  if (definition?.plan) return null
  return definition?.step?.(operation) || { kind: 'execute', target: null }
}

async function planningProject(home, operation) {
  if (!operation.projectId) return null
  const root = await projectStore(home).read(operation.projectId)
  const episodeId = operation.episodeId || (root.episodes.length === 1 ? root.episodes[0].id : null)
  return episodeId ? materialize(root, episodeId) : root
}

// 按当前项目生成步骤计划；读取失败时退回单个 execute 步骤（错误在执行时报告）。
export async function planSteps(home, operation) {
  const single = runnerStep(operation)
  if (single) return [single]
  let project = null
  try { project = await planningProject(home, operation) } catch { return [{ kind: 'execute', target: null }] }
  const steps = definitions[operation.action].plan(project, operation)
  return steps.length ? steps : [{ kind: 'execute', target: null }]
}

// 按操作定义的 tasks(project, operation) 把步骤计划划分为任务 [{ type, label, targets, maxRevisions, plan }]；
// 没有 tasks 的操作为单个任务（承接全部步骤）。未被任何任务认领的步骤归第一个任务。
export async function planTasks(home, operation) {
  const definition = definitions[operation.action]
  const plan = await planSteps(home, operation)
  let items = null
  if (definition?.tasks) {
    try { items = definition.tasks(await planningProject(home, operation), operation) } catch { items = null }
  }
  if (!items?.length) return [{ type: operation.action, label: definition?.label || operation.action, targets: null, maxRevisions: definition?.maxRevisions, plan }]
  const tasks = items.map(item => ({ maxRevisions: definition.maxRevisions, ...item, plan: plan.filter(step => item.targets.includes(step.target ?? null)) }))
  const claimed = new Set(items.flatMap(item => item.targets))
  tasks[0].plan.unshift(...plan.filter(step => !claimed.has(step.target ?? null)))
  return tasks.filter((task, index) => index === 0 || task.plan.length)
}
