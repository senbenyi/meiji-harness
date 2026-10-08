import { compileVideoPrompt } from './video-prompt-renderer.js'
// 技能详情页的请求预览：用当前剧集的实际上下文、已保存的技能组合（内置 + 基础 + 本剧）按真实的拼装函数
// 组装生成、意见修改、审核、自动修订请求，不调用模型。缺少上游内容时以占位说明代替任务上下文。
import { checkContext } from '../runtime/operation-context.js'
import { executionContext } from '../runtime/task-context.js'
import { builtinSkill } from '../../skills/load-skills.js'
import { buildStoryPrompts } from './story-prompts.js'
import { buildEpisodePrompts } from './episode-summary-prompts.js'
import { buildSecondsPrompts, buildSingleShotPrompts, buildTablePrompts } from './shot-text-prompts.js'
import { buildTextPrompts } from './text-prompts.js'
import { render } from './skill-prompts.js'
import characterImage from './interfaces/character-image-interface.js'
import sceneImage from './interfaces/scene-image-interface.js'
import { imagePreviewSegments } from './interfaces/prompt-interfaces.js'
import { FilmModel } from './models/video-prompt-model.js'

const placeholder = '（任务与上下文由程序在运行时填入：本集资料、上下游内容与本次目标。当前剧集缺少所需的上游内容，此处以说明代替。）'
const opinion = '（此处为人工修改意见）'

function textBuilder(stage, root, view, mode, nodeKey) {
  const shot = view?.shots?.items?.find(item => `seconds:${item.id}` === nodeKey) || view?.shots?.items?.[0]
  if (stage === 'episode' && view) return () => buildEpisodePrompts(root, view.episodeId)
  if (stage === 'outline' && view?.summary?.content) return () => buildStoryPrompts(view, nodeKey || 'outline', '', { extraction: ['characters', 'scenes'].includes(nodeKey) && checkContext.getStore()?.generationMode !== 'modify' })
  if (stage === 'shots' && view?.plot?.outline?.content) return () => buildTablePrompts({ project: view })
  if (stage === 'shot-revise' && shot) return () => buildSingleShotPrompts({ project: view, shotId: shot.id })
  if (stage === 'seconds' && shot) return () => buildSecondsPrompts({ project: view, shotId: shot.id })
  const instructions = stage === 'image-prompt' ? '原提示词：（人物或场景的原提示词）\n新要求：（人工填写的新要求）' : placeholder
  return () => buildTextPrompts({ skill: stage, project: view || root, instructions, mode, opinion: checkContext.getStore()?.review || '', modify: checkContext.getStore()?.generationMode === 'modify' })
}

const request = message => ({ system: message.segments.system, user: message.segments.user, chars: message.system.length + message.user.length })

export function previewPrompts({ stage, root, view, skillSet, mode = 'reference', canvas, nodeKey }) {
  const meta = builtinSkill(stage)
  if (meta.kind !== 'stage') throw Object.assign(new Error('只有阶段技能可以预览请求'), { status: 400 })
  return executionContext.run({ skillSet, skills: new Map() }, () => {
    const project = view || root
    if (meta.output === 'image') {
      const segments = imagePreviewSegments({ stage, project, request: '（本次画面要求由程序按卡片或文本分镜生成）', canvas })
      const result = { image: { system: [], user: segments, chars: render(segments).length } }
      if (['character-image', 'scene-image'].includes(stage)) {
        const character = stage === 'character-image'
        const api = character ? characterImage : sceneImage
        const item = (character ? project?.plot?.characters : project?.plot?.scenes)?.items?.find(entry => entry.type === (character ? 'role' : 'scene'))
        if (item) {
          const user = api.modify({ item, project, canvas: canvas || (character ? { width: 768, height: 1344 } : undefined), instruction: opinion, images: [{ purpose: 'edit-base', base64: 'data:image/png;base64,AA==' }] })
          result.modify = { system: [], user, chars: render(user).length }
        } else result.modify = null
      }
      return result
    }
    if (stage === 'storyboard') {
      const shot = view?.shots?.items?.find(s => `storyboard:${s.id}` === nodeKey) || view?.shots?.items?.[0]
      let text = '程序根据已通过的每秒分镜和素材清单组装；请先生成每秒分镜。'
      if ([1, 2].includes(shot?.seconds?.content?.version)) text = compileVideoPrompt(view, shot).prompt.text
      return { generate: { system: [], user: [{ source: 'protocol', title: '【程序组装结果，无模型请求】', text }], chars: text.length }, modify: null, review: null, revise: null }
    }
    if (meta.output === 'video') {
      const segments = new FilmModel({ project, prompt: '（已审核的文本分镜最终视频提示词）', mode }).toGenerateSegments()
      return { video: { system: [], user: segments, chars: render(segments).length } }
    }
    const build = textBuilder(stage, root, view, mode, nodeKey)
    const regenerate = checkContext.run({ generationMode: 'regenerate', requestedMode: stage === 'outline' && !view?.plot?.outline?.content ? 'generate' : 'regenerate', review: '', requirements: '', originalProject: project }, build)
    let modify
    try { modify = checkContext.run({ generationMode: 'modify', requestedMode: 'modify', review: opinion, requirements: '', originalProject: project }, build).generation }
    catch { modify = null }
    const requests = {
      generate: request(regenerate.generation),
      modify: modify ? request(modify) : null,
      review: request(regenerate.review('（待审内容）')),
      revise: request(regenerate.revision('（自审未通过的稿件）', JSON.stringify({ passed: false, issues: [{ location: '本次内容', reason: '（自审不通过原因）', requirement: '修正上述问题' }] }))),
    }
    if (stage === 'outline' && view?.plot && !nodeKey) {
      for (const kind of ['characters', 'scenes']) {
        const extract = checkContext.run({ generationMode: 'regenerate', review: '', requirements: '' }, () => buildStoryPrompts(view, kind, '', { extraction: true }))
        const modify = checkContext.run({ generationMode: 'modify', review: opinion, requirements: '', originalProject: view }, () => buildStoryPrompts(view, kind)).generation
        requests[`${kind}_generate`] = request(extract.generation)
        requests[`${kind}_modify`] = request(modify)
        requests[`${kind}_review`] = request(extract.review('（待审卡片）'))
        requests[`${kind}_revise`] = request(extract.revision('（自审未通过的卡片）', JSON.stringify({ passed: false, issues: [{ location: '本次内容', reason: '（本轮自审原因）', requirement: '修正上述问题' }] })))
      }
    }
    return requests
  })
}
