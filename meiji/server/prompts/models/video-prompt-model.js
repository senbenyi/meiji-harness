// 视频接口独立定义最终 prompt；网络层只按原样发送。
import { addition, currentSkillSet, recordUse, segment, render } from '../skill-prompts.js'
import { builtinSkill } from '../../../skills/load-skills.js'
import { withReviewPrompt } from '../../runtime/review-checks.js'

function videoSegments({ project, prompt, skillSet, mode, opening = {}, imageCount = 0 }) {
  const set = currentSkillSet(project, skillSet)
  const supplement = [set.skills.video.constraints, addition(set, 'video', 'generate')].filter(Boolean).join('\n')
  const segments = [segment('context', '【本次任务】', '按下方已审核文本分镜生成本镜视频，保留事件、顺序、结果与素材编号。'), segment('context', '【已审核文本分镜】', prompt)]
  if (supplement) {
    recordUse(set, builtinSkill('video'), [])
    segments.push(segment('stage', '【基础生产规则】', supplement, { skill: 'video', field: 'generate' }))
  }
  const original = render(segments)
  const reviewed = withReviewPrompt(original)
  if (reviewed !== original) segments.push(segment('context', '', reviewed.slice(original.length)))
  if (mode === 'reference' && opening.referenceUrl) {
    const tag = `<Picture ${imageCount + 1}>`
    segments.push(segment('context', '【开场衔接上下文】', project.outputLanguage === 'en'
      ? `Opening continuity reference: ${tag} is the final frame of the previous clip ${opening.previous}. Use it to establish the opening positions, body headings, camera side, background orientation, lighting and ongoing action. Preserve identities and story costumes from the existing subject references. Continue the stated timeline without replaying actions or adding a portrait close-up. This is a reference image, not a strict API first frame.`
      : `开场衔接参考：${tag} 是上一镜 ${opening.previous} 的尾帧，用于衔接开场人物位置、身体朝向、机位侧别、背景方向、光照和进行中的动作。身份和剧情服装仍以既有主体参考及正文为准。按本镜时间线继续，不重演动作，不额外插入人物特写。这是参考图，不是接口强制首帧。`))
  }
  return segments
}

export class FilmModel {
  constructor(task = {}) { this.task = { ...task } }
  toGenerateSegments() { return videoSegments(this.task) }
  toReviseSegments(prompt) { return videoSegments({ ...this.task, prompt }) }
}
