import { mergeLibraryGroup } from '../../../shared/library-rules.js'
// 共享函数：任务与操作共用
import { runTextNodes } from '../tasks/text-workflow.js'
import { checkContext } from '../../runtime/operation-context.js'
import { modelRoutes } from '../../../models/model-config.js'
import { promptsForCharacters, parseCharacters } from '../steps/step-extract-characters.js'
import { promptsForScenes, parseScenes } from '../steps/step-extract-scenes.js'
import { preserveStoryAssets } from '../../../shared/preserve-story-assets.js'
import { plotPatch } from '../../../shared/drama-model.js'
import { cascade } from '../../../shared/pipeline-cascade.js'

export async function regenerateCardGroup({ project, kind, route, review, persist, signal, fetchImpl, request, extraction = false }) {
  if (!['characters', 'scenes'].includes(kind)) throw Object.assign(new Error('剧情流程不再生成道具，按空集合处理'), { status: 400 })
  const normalize = text => ({ characters: parseCharacters, scenes: parseScenes })[kind](text, project)
  const result = await runTextNodes({
    target: kind,
    prompts: ({ characters: promptsForCharacters, scenes: promptsForScenes })[kind](project, review, { extraction }),
    options: { route, project, signal, fetchImpl, request }, check: text => { normalize(text); return [] }, persist: persist && ((text, check) => persist({ ...normalize(text), check })),
  })
  return { ...normalize(result.text), check: result.check }
}

// if (operation.action === 'characters' || operation.action === 'scenes')
export async function opCharacters(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const kind = operation.action
  if (project.plot.outline.check.passed !== true) throw Object.assign(new Error('请先生成并通过剧情大纲审核'), { status: 409 })
  project = await projects.save(project.id, current => cascade(current, { type: 'cards', key: kind }).patch)
  const group = await (deps.regenerateCardGroup || regenerateCardGroup)({ project, kind, route: (modelRoutes(await models.read())).story, review: operation.review, fetchImpl: deps.fetchImpl, request: deps.request, extraction: operation.extraction, persist: async group => {
    const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, props: project.plot.props, [kind]: group, check: group.check })
    await projects.save(project.id, plotPatch(project, { [kind]: merged[kind] }))
  } })
  const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, props: project.plot.props, [kind]: group, check: group.check })
  checkContext.getStore().validation = group.check.failures
  await projects.save(project.id, group.check.passed ? mergeLibraryGroup(project, kind, merged[kind]) : plotPatch(project, { [kind]: merged[kind] }), { final: true })
  note(`${({ characters: '人物卡', scenes: '场景卡', props: '道具卡' })[kind]}已保存${group.check.passed ? '并通过自审' : '，自审未通过：' + group.check.failures.join('；')}`)
  return trace
}
