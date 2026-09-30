// 技能详情页的请求预览：用当前剧集的实际上下文、已保存的技能组合（内置 + 基础 + 本剧）按真实的拼装函数
// 组装生成、意见修改、审核、自动修订请求，不调用模型。缺少上游内容时以占位说明代替任务上下文。
import { checkContext } from '../data/operation-context.js'
import { executionContext } from '../data/task-store.js'
import { builtinSkill } from '../../skills/load.js'
import { buildEpisodePrompts, buildStoryPrompts } from './story-prompts.js'
import { buildSecondsPrompts, buildSingleShotPrompts, buildStoryboardPrompts, buildTablePrompts } from './shot-prompts.js'
import { buildTextPrompts } from './text-prompts.js'
import { render } from './skill-prompts.js'
import { imagePreviewSegments } from './interfaces/registry.js'
import videoSegments from './interfaces/video.js'

const placeholder = '（任务与上下文由程序在运行时填入：本集资料、上下游内容与本次目标。当前剧集缺少所需的上游内容，此处以说明代替。）'
const opinion = '（此处为人工修改意见）'

function textBuilder(stage, root, view, mode) {
  const shot = view?.shots?.items?.[0]
  if (stage === 'episode' && view) return () => buildEpisodePrompts(root, view.episodeId)
  if (stage === 'outline' && view?.summary?.content) return () => buildStoryPrompts(view)
  if (stage === 'shots' && view?.plot?.outline?.content) return () => buildTablePrompts({ project: view })
  if (stage === 'shot-revise' && shot) return () => buildSingleShotPrompts({ project: view, shotId: shot.id })
  if (stage === 'seconds' && shot) return () => buildSecondsPrompts({ project: view, shotId: shot.id })
  if (stage === 'storyboard' && shot) return () => buildStoryboardPrompts({ project: view, shotId: shot.id }, { shot, video: mode, characters: shot.cast || [], scenes: shot.scene ? [shot.scene] : [], refs: mode === 'reference' ? '（参考图片列表由程序按本镜关联素材提供）' : '', images: [] })
  const instructions = stage === 'image-prompt' ? '原提示词：（人物或场景的原提示词）\n新要求：（人工填写的新要求）' : placeholder
  return () => buildTextPrompts({ skill: stage, project: view || root, instructions, reviewInstructions: instructions, mode, opinion: checkContext.getStore()?.review || '', modify: checkContext.getStore()?.generationMode === 'modify' })
}

const request = message => ({ system: message.segments.system, user: message.segments.user, chars: message.system.length + message.user.length })

export function previewPrompts({ stage, root, view, skillSet, mode = 'reference' }) {
  const meta = builtinSkill(stage)
  if (meta.kind !== 'stage') throw Object.assign(new Error('只有阶段技能可以预览请求'), { status: 400 })
  return executionContext.run({ skillSet, skills: new Map() }, () => {
    const project = view || root
    if (meta.output === 'image') {
      const segments = imagePreviewSegments({ stage, project, request: '（本次画面要求由程序按卡片或文本分镜生成）' })
      return { image: { system: [], user: segments, chars: render(segments).length } }
    }
    if (meta.output === 'video') {
      const segments = videoSegments({ project, prompt: '（已审核的文本分镜最终视频提示词）', mode })
      return { video: { system: [], user: segments, chars: render(segments).length } }
    }
    const build = textBuilder(stage, root, view, mode)
    const regenerate = checkContext.run({ generationMode: 'regenerate', requestedMode: 'regenerate', review: '', requirements: '', originalProject: project }, build)
    let modify
    try { modify = checkContext.run({ generationMode: 'modify', requestedMode: 'modify', review: opinion, requirements: '', originalProject: project }, build).generation }
    catch { modify = null }
    return {
      generate: request(regenerate.generation),
      modify: modify ? request(modify) : null,
      review: request(regenerate.review('（待审内容）')),
      revise: request(regenerate.revision('（自审未通过的稿件）', 'FAIL （自审不通过原因）')),
    }
  })
}
