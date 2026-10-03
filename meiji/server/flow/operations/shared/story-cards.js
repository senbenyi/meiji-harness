// 共享函数：任务与操作共用
import { runTextSteps } from '../../../runtime/text-generation.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { buildStoryPrompts } from '../../../prompts/story-prompts.js'
import { normalizeCharacters, normalizeScenes, normalizeProps } from '../../../../shared/story-content.js'
import { preserveStoryAssets } from '../../../../shared/preserve-story-assets.js'
import { plotPatch } from '../../../../shared/drama-model.js'

export async function regenerateCardGroup({ project, kind, route, review, persist, signal, fetchImpl, request }) {
  const normalize = text => kind === 'props' ? normalizeProps(parseJsonValue(text), project) : (kind === 'characters' ? normalizeCharacters : normalizeScenes)(parseJsonValue(text))
  const result = await runTextSteps({
    target: kind,
    prompts: buildStoryPrompts(project, kind, review),
    options: { route, project, signal, fetchImpl, request }, check: text => { normalize(text); return [] }, persist: persist && ((text, check) => persist({ ...normalize(text), check })),
  })
  return { ...normalize(result.text), check: result.check }
}

// if (operation.action === 'characters' || operation.action === 'scenes')
export async function opCharacters(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const kind = operation.action
  if (kind === 'props' && ['outline', 'characters', 'scenes'].some(key => project.plot[key].check.passed !== true || project.plot[key].stale)) throw Object.assign(new Error('请先完成并通过大纲、人物及场景审核，再提取道具'), { status: 409 })
  const group = await (deps.regenerateCardGroup || regenerateCardGroup)({ project, kind, route: (modelRoutes(await models.read())).story, review: operation.review, persist: async group => {
    const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, props: project.plot.props, [kind]: group, check: group.check })
    await projects.save(project.id, plotPatch(project, { [kind]: merged[kind] }))
  } })
  const merged = preserveStoryAssets(project, { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes, props: project.plot.props, [kind]: group, check: group.check })
  checkContext.getStore().validation = group.check.failures
  await projects.save(project.id, { ...plotPatch(project, { [kind]: merged[kind] }) }, { final: true })
  note(`${({ characters: '人物卡', scenes: '场景卡', props: '道具卡' })[kind]}已保存${group.check.passed ? '并通过自审' : '，自审未通过：' + group.check.failures.join('；')}`)
  return trace
}
