import { projectCharacterPrompts } from '../../../prompts/project-character-prompts.js'
import { node, setContent } from '../../../models/data/drama-model.js'
import { characterExtractionContent, characterExtractionProject } from '../../../../shared/character-extraction.js'
import { createLibraryEntry, characterLibraryTarget } from '../../../../shared/library-rules.js'
import { mergeCostumes } from '../../../../shared/character-costumes.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { parseCharacters } from '../../steps/step-extract-characters.js'
import { runTextNodes } from '../text-workflow.js'

export function publishProjectCharacters(project, group) {
  for (const card of group.items) {
    const target = characterLibraryTarget(project, card)
    if (target) target.variant.fields.costumes = mergeCostumes(target.variant.fields.costumes, card.costumes)
    else createLibraryEntry(project, 'characters', card)
  }
}

export async function runProjectCharacters({ operation, deps, projects, models, project, trace }) {
  if (project.mode !== 'script' || !project.script?.trim()) throw Object.assign(new Error('请先导入或填写剧本'), { status: 409 })
  const modify = operation.step === 'revise', previous = project.projectCharacters
  const source = modify ? characterExtractionProject(project, previous) : project
  const base = modify ? characterExtractionContent(source, previous) : ''
  const opinion = operation.review || previous?.check.failures.join('；') || ''
  const parse = text => parseCharacters(text, source)
  await runTextNodes({ target: 'project-characters', prompts: projectCharacterPrompts(modify ? source : { ...project, projectCharacters: undefined }, base, opinion),
    options: { route: modelRoutes(await models.read()).story, project, fetchImpl: deps.fetchImpl, request: deps.request },
    check: text => { parse(text); return [] },
    persist: (text, check) => projects.save(project.id, current => {
      const group = parse(text), next = structuredClone(current)
      next.projectCharacters = { ...(current.projectCharacters || node('project-characters')), items: group.items, extractionLibraryIds: group.extractionLibraryIds, basis: { scriptRevision: project.scriptRevision } }
      setContent(next.projectCharacters, null, check)
      return next
    }),
  })
  trace.result = { characters: true }
  return trace
}
