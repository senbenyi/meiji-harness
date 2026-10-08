import { materialize } from './episode-rules.js'
import { targetNode } from './drama-model.js'

export function textStepNode(project, target, episodeId) {
  if (target === 'project-summary') return project.summary
  const view = project.episodes ? materialize(project, episodeId) : project
  return targetNode(view, target)
}
export function requireStepContent(project, target, episodeId) {
  const node = textStepNode(project, target, episodeId)
  if (!node || (node.items ? !node.items.length && target !== 'props' && !(target === 'characters' && node.secondsSource) : !node.content)) throw Object.assign(new Error('目标没有可审核或修订的内容，请先生成'), { status: 409 })
  return node
}
