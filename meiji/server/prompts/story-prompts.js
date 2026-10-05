import { currentSkillSet } from './skill-prompts.js'
import { checkContext } from '../runtime/operation-context.js'
import { buildTextPrompts } from './text-prompts.js'
import { StoryModel, storyKinds } from './models/story-model.js'

// 修订基稿只给卡片内容字段；图片、审核状态、操作记录等内部状态不进入提示词。
const cardState = new Set(['image', 'status', 'revision', 'baseRevision', 'check', 'review', 'operation', 'error', 'parts', 'draft'])
const cardContent = item => Object.fromEntries(Object.entries(item || {}).filter(([key, value]) => !cardState.has(key) && value != null))

export function buildStoryPrompts(project, kind = 'outline', review = '', { extraction = false } = {}) {
  const ctx = checkContext.getStore()
  const modify = !extraction && ctx?.generationMode === 'modify'
  const original = ctx?.originalProject || project
  const baseContent = modify ? kind === 'outline'
    ? original.plot.outline.content
    : { items: (original.plot[kind].items || []).map(cardContent) } : ''
  const opinion = modify ? [...new Set([ctx?.review, review].filter(Boolean))].join('\n') : ''
  const mode = modify ? 'modify' : extraction || ctx?.requestedMode === 'generate' || (!project.plot.outline.content && ctx?.requestedMode !== 'regenerate') ? 'generate' : 'regenerate'
  if (!storyKinds[kind]) throw new Error('未知剧情资料类型')
  const model = new StoryModel(kind, { project, mode, baseContent, opinion, generationRules: currentSkillSet(project).skills.outline.rules[kind], reviewRules: currentSkillSet(project).skills.outline.reviewRules[kind] })
  return buildTextPrompts({ skill: 'outline', project, modify, model, opinion })
}
