import { checkContext } from '../data/operation-context.js'
import { buildTextPrompts } from './text-prompts.js'
import { currentSkillSet } from './skill-prompts.js'
import { EpisodeSummaryModel } from './models/episode-summary-model.js'

export function buildEpisodePrompts(project, episodeId, referenceDurationSeconds) {
  const ctx = checkContext.getStore()
  const modify = ctx?.generationMode === 'modify'
  const model = new EpisodeSummaryModel({ project, episodeId, referenceDurationSeconds,
    generationRules: currentSkillSet(project).skills.episode.constraints,
    reviewRules: currentSkillSet(project).skills.episode.review,
    mode: modify ? 'modify' : episodeId ? 'regenerate' : 'generate', opinion: ctx?.review || '' })
  return buildTextPrompts({ skill: 'episode', project, model, modify, nodeKey: 'summary', episodeId,
    opinion: model.modification?.instruction || '',
  })
}
