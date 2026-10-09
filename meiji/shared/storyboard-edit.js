import { shotResult, updateShotResult } from '../server/models/data/drama-model.js'
import { videoPromptText as h3PromptText } from './video-prompt-text.js'
import { clearShotDownstream } from './project-rules.js'
export function storyboardTextPatch(project, { track, text, originalText, draftRevision }) {
  const item = shotResult(project, 'storyboard', track)
  if (!item) throw Object.assign(new Error('请先生成这一镜的文本分镜'), { status: 404 })
  if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw Object.assign(new Error('文本分镜需为 1–100000 字'), { status: 400 })
  if (originalText !== h3PromptText(item.prompt)) throw Object.assign(new Error('这一镜的文本分镜已更新，请刷新后重新编辑'), { status: 409 })
  if (text.trim() === originalText) return {}
  const next = { ...project, ...clearShotDownstream(project, 'storyboard', track) }
  const edited = { ...item }; delete edited.sourceMap
  const patch = updateShotResult(next, 'storyboard', track, { ...edited, format: 'text', prompt: { text: text.trim() } })
  const target = patch.shots.items.find(shot => shot.id === track).storyboard
  if (target.draft.revision === draftRevision) target.draft = { text: null, baseRevision: null, revision: target.draft.revision + 1 }
  return { ...next, ...patch }
}
