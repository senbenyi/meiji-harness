import { StoryPropsModel } from './models/story-props-model.js'
import { currentSkillSet } from './skill-prompts.js'
import { checkContext } from '../data/operation-context.js'
import { buildTextPrompts } from './text-prompts.js'
import { StoryOutlineModel } from './models/story-outline-model.js'
import { StoryCharacterModel } from './models/story-character-model.js'
import { StorySceneModel } from './models/story-scene-model.js'

export function buildStoryPrompts(project, kind = 'outline', review = '', { extraction = false } = {}) {
  const ctx = checkContext.getStore()
  const modify = !extraction && ctx?.generationMode === 'modify'
  const original = ctx?.originalProject || project
  const baseContent = modify ? kind === 'outline'
    ? original.plot.outline.content
    : { items: original.plot[kind].items } : ''
  const opinion = modify ? [...new Set([ctx?.review, review].filter(Boolean))].join('\n') : ''
  const mode = modify ? 'modify' : extraction || ctx?.requestedMode === 'generate' || (!project.plot.outline.content && ctx?.requestedMode !== 'regenerate') ? 'generate' : 'regenerate'
  const Model = { outline: StoryOutlineModel, characters: StoryCharacterModel, scenes: StorySceneModel, props: StoryPropsModel }[kind]
  if (!Model) throw new Error('未知剧情资料类型')
  const model = new Model({ project, mode, baseContent, opinion, generationRules: currentSkillSet(project).skills.outline.rules[kind] })
  return buildTextPrompts({ skill: 'outline', project, modify, model, opinion })
}
