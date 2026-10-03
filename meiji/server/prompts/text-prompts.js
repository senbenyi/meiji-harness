// 文本请求分发与序列化。角色内容、顺序和 JSON 模式由 interfaces/<skill>.js 决定。
// task：{ skill: 阶段技能 ID, project, instructions（{ task, review, facts } 或任务文本）, opinion, reviewContext, mode（文本分镜模式）, modify（按人工意见修改）}
import { isSkill, builtinSkill } from '../../skills/load-skills.js'
import { continuityReviewContext } from './continuity-review.js'
import { storyboardContext } from './storyboard-context.js'
import { shotReferenceImages } from '../../shared/reference-images.js'
import { render } from './skill-prompts.js'
import { textInterface } from './interfaces/prompt-interfaces.js'
import { contentData } from './prompt-text.js'

function message(stage, { system = [], user = [], json = false }) {
  return { skill: stage, json, system: render(system), user: render(user), segments: { system, user } }
}

export function buildGenerationPrompt(task) {
  return message(task.skill, textInterface(task.skill).generate(task))
}

export function buildReviewPrompt(task, content) {
  // skill 记为 review：执行器与日志据此区分审核请求；stage 为所审阶段。
  return { ...message(task.skill, textInterface(task.skill).review(task, content)), skill: 'review', stage: task.skill }
}

export function buildRevisionPrompt(task, content, review) {
  return message(task.skill, textInterface(task.skill).revise(task, content, review))
}

export function buildTextPrompts(task) {
  return {
    generation: buildGenerationPrompt(task),
    review: (content, revision = {}) => buildReviewPrompt({ ...task, ...revision }, content),
    revision: (content, review, overrides = {}) => buildRevisionPrompt({ ...task, ...overrides }, content, review),
  }
}

// 人工编辑后的审核。stage 为阶段技能 ID（storyboard / outline）或审核范围说明（按剧情整包的验收标准审核）。
export function buildEditedContentReview({ project, stage, shotId }, text) {
  const skill = isSkill(stage) ? stage : 'outline'
  if (stage === 'outline') return buildReviewPrompt({ project, skill, edited: true, editedKind: 'outline' }, contentData(text, 'outline'))
  const shot = project.shots?.items.find(item => item.id === shotId)
  if (stage === 'storyboard' && shot) {
    const board = shot.storyboard.content || {}
    const images = shotReferenceImages(project, board)
    const mode = board.video || (images.length ? 'reference' : 'text')
    return buildReviewPrompt({ project, skill, shotId, mode,
      instructions: storyboardContext({ project, shot, video: mode,
        characters: board.characterIds || board.characters || shot.cast || [],
        scenes: board.sceneIds || board.scenes || (shot.scene ? [shot.scene] : []),
        refs: images.map((image, index) => ({ reference: `<Picture ${index + 1}>`, label: image.label || image.name || image.id || image.sourceShotId || '参考图' })),
        task: `只审核 ${shot.id} 已编辑的最终提示词是否忠实转写本镜每秒指令、正确绑定素材并符合输出结构。` }),
    }, text)
  }
  return buildReviewPrompt({ project, skill, edited: true, editedKind: stage,
    instructions: { review: `审核已编辑原文。审核范围：${isSkill(stage) ? builtinSkill(stage).label : stage}`,
      facts: [{ title: '【本集摘要】', text: project.summary.content }, { title: '【剧情大纲】', text: project.plot.outline.content ? project.plot.outline.content : '' }] },
    reviewContext: continuityReviewContext(project, shotId),
  }, contentData(text, /^人物/.test(stage) ? 'characters' : /^场景/.test(stage) ? 'scenes' : 'outline'))
}
