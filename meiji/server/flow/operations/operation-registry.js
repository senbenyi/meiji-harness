import { operations as characterDelete } from './direct/operation-character-delete.js'
import { operations as projectLibrary } from './direct/operation-project-library.js'
import { operations as propText } from './direct/operation-prop-edit.js'
import { operations as actionsEpisodeEpisodeDelete } from './direct/operation-episode-delete.js'
import { operations as actionsEpisodeEpisodeSave } from './direct/operation-episode-save.js'
import { operations as actionsEpisodeSource } from './direct/operation-source-edit.js'
import { operations as actionsImageClearImage } from './direct/operation-image-clear.js'
import { operations as actionsImageImageCandidate } from './direct/operation-image-candidate.js'
import { operations as actionsImageImportImage } from './direct/operation-image-import.js'
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
import { operations as scriptDirect } from './direct/operation-script.js'
const direct = { ...characterDelete, ...libraryDelete, ...projectLibrary, ...propText, ...actionsEpisodeEpisodeDelete, ...actionsEpisodeEpisodeSave, ...actionsEpisodeSource, ...actionsImageClearImage, ...actionsImageImageCandidate, ...actionsImageImportImage, ...actionsImageReference, ...actionsImageUseAsset, ...actionsProjectCreate, ...actionsProjectLibraryImport, ...actionsProjectOpen, ...actionsProjectOverview, ...actionsProjectProjectDelete, ...actionsReviewOverride, ...actionsShotAssemble, ...actionsShotShotAssets, ...actionsShotStoryboardText, ...actionsStoryCharacterText, ...actionsStoryOutlineText, ...actionsStoryPropDelete, ...actionsStorySceneText }
// 只登记即时保存；制作目标由 shared/run-planner.js 规划，不在这里声明步骤。
export const operations = Object.fromEntries(Object.entries({ ...direct, ...scriptDirect }).map(([id, value]) => [id, { ...value, kind: 'direct', actor: 'human' }]))
const goals = new Set(['summary', 'project-summary', 'story', 'script-sync', 'script-revise', 'character-image', 'scene-image', 'prop-image', 'library-image', 'images', 'shot-table', 'seconds', 'film'])
export function validateOperation(op) {
  if (goals.has(op?.action)) throw Object.assign(new Error('制作请通过任务目标预览发起'), { status: 400, code: 'RUN_GOAL_REQUIRED' })
  const definition = Object.hasOwn(operations, op?.action) ? operations[op.action] : null
  if (!definition) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  if (op.origin === 'session' && !definition.agent) throw Object.assign(new Error('该操作只能由人在面板上执行'), { status: 403 })
  return definition
}
