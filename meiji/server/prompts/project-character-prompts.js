import { characterExtractionProject } from '../../shared/character-extraction.js'
import { currentSkillSet } from './skill-prompts.js'
import { StoryCharacterModel } from './models/story-model.js'
import { buildTextPrompts } from './text-prompts.js'

export function projectCharacterPrompts(project, base = '', opinion = '') {
  const source = { ...characterExtractionProject(project, project.projectCharacters), scriptCharacterExtraction: true }
  const rules = currentSkillSet(project).skills.outline
  const model = new StoryCharacterModel({ project: source, mode: base ? 'modify' : 'generate', baseContent: base, opinion,
    generationRules: rules.rules.characters, reviewRules: rules.reviewRules.characters })
  return buildTextPrompts({ skill: 'outline', project: source, model, modify: Boolean(base), opinion })
}

