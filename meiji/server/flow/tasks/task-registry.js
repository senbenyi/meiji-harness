// 独立任务注册：队列、基础节点和修订上限在任务层定义。
import { textNodes } from '../../../shared/task-nodes.js'
import { imageSteps, videoSteps, storyboardSteps } from '../../../shared/task-plans.js'
import { runSummary } from './text/task-summary.js'
import { runProjectSummary } from './text/task-project-summary.js'
import { runOutline } from './text/task-outline.js'
import { runCharacters } from './text/task-characters.js'
import { runScenes } from './text/task-scenes.js'
import { runProps } from './text/task-props.js'
import { runShotTable } from './text/task-shot-table.js'
import { opShotSeconds } from './text/task-shot-seconds.js'
import { opShotStoryboard } from './text/task-storyboard-prompt.js'
import { runCharacterImage } from './media/task-character-image.js'
import { runSceneImage } from './media/task-scene-image.js'
import { runPropImage } from './media/task-prop-image.js'
import { runVideo } from './media/task-video.js'
import { storyboardReady, videoReady, tailReady } from '../shared/film-freshness.js'
import { runSave } from './text/task-save.js'

const text = (label, run, action, target) => ({ label, run, queue: 'text', maxRevisions: 2, stage: 'episode', action, target, nodes: op => textNodes(typeof target === 'function' ? target(op) : target) })
const image = (label, run) => ({ label, run, queue: 'image', maxRevisions: 0, stage: 'episode', action: 'image', target: op => `image:${op.itemId}`, nodes: op => imageSteps(`image:${op.itemId}`) })
export const taskRegistry = {
  'project-summary': { ...text('项目摘要', runProjectSummary, 'project-summary', 'project-summary'), stage: 'project' },
  summary: { ...text('摘要', runSummary, 'episode-generate', 'summary'), stage: 'project', nodes: op => [...textNodes('summary'), ...(op.draft ? [{ kind: 'save', target: 'summary-draft' }] : [])] },
  outline: text('大纲', runOutline, 'outline', 'outline'),
  characters: text('人物角色', runCharacters, 'characters', 'characters'),
  scenes: text('场景', runScenes, 'scenes', 'scenes'),
  props: text('道具', runProps, 'props', 'props'),
  'shot-table': text('镜头表', runShotTable, op => op.track ? 'revise-shot' : 'shots', 'shots'),
  'shot-seconds': text('每秒指令', opShotSeconds, 'shot-seconds', op => `seconds:${op.track}`),
  'storyboard-prompt': { ...text('分镜提示词', opShotStoryboard, 'shot-storyboard', op => `storyboard:${op.track}`), maxRevisions: 0, skip: (project, op) => !op.parts && (videoReady(project.shots.items.find(item => item.id === op.track)) || storyboardReady(project, op.track)), nodes: op => storyboardSteps(op.track) },
  'character-image': image('角色图', runCharacterImage), 'scene-image': image('场景图', runSceneImage), 'prop-image': image('道具图', runPropImage),
  video: { skip: (project, op) => { const shot = project.shots.items.find(item => item.id === op.track); return !op.parts && videoReady(shot) && tailReady(shot) }, label: '视频', run: runVideo, queue: 'video', maxRevisions: 0, stage: 'episode', action: 'film', target: op => `film:${op.track}`, nodes: op => op.parts === 'tail' ? [{ kind: 'tail_frame', target: `film:${op.track}` }] : videoSteps(op.track) },
  save: { label: '保存', run: runSave, queue: null, maxRevisions: 0, actor: 'human' },
}
export function taskDefinition(type) {
  const value = taskRegistry[type]
  if (!value) throw new Error(`不支持的任务类型：${type}`)
  return value
}
export function describeTask(item, op, direct, project) {
  const definition = taskDefinition(item.type), operation = { ...op, ...item.params }
  const target = direct ? direct.step?.(op, project)?.target ?? direct.plan?.(project, op)?.[0]?.target ?? null : typeof definition.target === 'function' ? definition.target(operation) : definition.target
  return { ...item, label: item.label || `${definition.label}${operation.track ? ' ' + operation.track : ''}${operation.itemId ? ' ' + operation.itemId : ''}`,
    target, targets: item.targets || [target], queue: definition.queue, actor: definition.actor || 'model', maxRevisions: definition.maxRevisions,
    plan: direct ? direct.plan?.(project, op) || [direct.step?.(op, project) || { kind: 'save', target }] : definition.nodes(operation),
    operation: { ...operation, action: direct ? op.action : typeof definition.action === 'function' ? definition.action(operation) : definition.action, ...(item.type === 'outline' ? { stageKey: 'outline' } : {}) }, definition: direct ? { ...direct, run: context => runSave(context, direct) } : { ...definition, ...(item.type === 'project-summary' && operation.draft && !operation.projectId ? { stage: 'pre' } : {}) } }
}
