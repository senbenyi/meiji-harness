import { checkContext } from '../data/operation-context.js'
import { buildTextPrompts } from './text-prompts.js'
import { currentSkillSet } from './skill-prompts.js'
import { EpisodeSummaryModel } from './models/episode-summary-model.js'

export function buildEpisodePrompts(project, episodeId, referenceDurationSeconds) {
  const ctx = checkContext.getStore()
  const modify = ctx?.generationMode === 'modify'
  const model = new EpisodeSummaryModel({ project, episodeId, referenceDurationSeconds,
    generationRules: currentSkillSet(project).skills.episode.constraints,
    mode: modify ? 'modify' : episodeId ? 'regenerate' : 'generate', opinion: ctx?.review || '' })
  const context = model.contextText()
  const mode = modify ? '按意见定向修订' : episodeId ? '重新生成，不使用本集旧摘要和历史意见' : '首次生成'
  return buildTextPrompts({ skill: 'episode', project, model, modify,
    instructions: `【任务模式】\n${mode}\n${context}` + (modify ? `\n【修改基稿】\n${JSON.stringify({ summary: model.modification.baseSummary, durationSeconds: model.modification.durationSeconds })}` : ''),
    reviewInstructions: context, opinion: model.modification?.instruction || '',
  })
}
