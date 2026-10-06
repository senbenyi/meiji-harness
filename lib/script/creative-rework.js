import { assetExtractionRequest, assetScriptRefs } from './asset-production.js'
import { NOVEL_SCHEMAS, assertStoryboard, storyboardPrompt } from './novel-production.js'
import { shotPromptRequests, mergeShotPrompts } from './shot-production.js'
import { ENTITY_COLLECTIONS, generationBasis, generationSchema, validateGeneration } from '../prompts/specification.js'

// Reauthoring and rendering are distinct durable tasks, using the same proposals as first production.
export async function runCreativeTask({ projects, projectId, task, checkpoint, runWorkflow }) {
  const project = await projects.getProject(projectId)
  const episodes = Object.values(project.episodes).filter((ep) => ep.id !== 'legacy-main')
  const episode = project.episodes[task.scopeId]
  const call = async (requests) => {
    const results = await runWorkflow(requests)
    return requests.map((request) => {
      const matches = results.filter((r) => r.label === request.label)
      if (matches.length !== 1 || matches[0].error || !matches[0].value) throw new Error(matches[0]?.error || '创作任务没有返回唯一完整结果')
      request.validate?.(matches[0].value)
      return matches[0].value
    })
  }
  let revision = task.checkpoint?.proposal
  if (!revision) {
    const sourceRefs = project.developmentProposals[project.storyBible?.proposalId]?.sourceRefs
    if (task.input.phase === 'asset-prompt') {
      const [entityKind, collection] = Object.entries(ENTITY_COLLECTIONS).find(([, key]) => project[key]?.[task.scopeId]) || []
      const entity = project[collection]?.[task.scopeId]
      if (!entity?.scriptRefs?.length) throw new Error('请先从当前正式剧本提取资产')
      const [generation] = await call([{ label: task.id, role: 'assets', phase: '资产图片提示词', schema: generationSchema('image'), validate: (value) => validateGeneration(value, 'image'),
        prompt: `只重新编写该资产的完整图片提示词，展开全部 details，不改变资产定义与剧本。若为衍生资产，保持本体身份，明确保持项和变化项。资产：${JSON.stringify(entity)}；剧本：${JSON.stringify(episodes.filter((ep) => entity.scriptRefs.some((ref) => ref.episodeId === ep.id)).map(({ id, script }) => ({ id, script })))}；本体：${JSON.stringify(entity.parentId && project[ENTITY_COLLECTIONS[entity.parentKind]]?.[entity.parentId])}` }])
      revision = { kind: 'asset_prompt', payload: { entityKind, entityId: entity.id, basis: generationBasis(project, entity, 'image'), generation }, sourceRefs }
    } else if (task.input.phase === 'assets') {
      if (!episodes.length || episodes.some((ep) => !ep.script)) throw new Error('请先完成全部正式分集剧本')
      const [value] = await call([assetExtractionRequest(episodes, project)])
      revision = { kind: 'asset_extraction', payload: { ...value, scriptRefs: assetScriptRefs(episodes) }, sourceRefs }
    } else if (task.input.phase === 'shots') {
      const assets = { characters: Object.values(project.characters).filter((e) => !e.retired), locations: Object.values(project.locations).filter((e) => !e.retired), props: Object.values(project.props || {}).filter((e) => !e.retired), assetVariants: Object.values(project.assetVariants || {}).filter((e) => !e.retired) }
      const analysis = { ...project.developmentProposals[project.storyBible.proposalId].payload, ...assets }
      const draft = { episodeId: episode.id, script: episode.script, beatIds: episode.beatIds, sourceSpans: episode.sourceSpans }
      const [board] = await call([{ label: `shots:${episode.id}`, role: 'shot', phase: '镜头规划', schema: NOVEL_SCHEMAS.storyboard,
        validate: (value) => assertStoryboard(analysis, episode, draft, value), prompt: storyboardPrompt(analysis, assets, episode, draft) }])
      revision = { kind: 'episode_script', payload: { ...draft, shots: board.shots, ...(episode.draftProposalId ? { draftProposalId: episode.draftProposalId } : {}) }, sourceRefs }
    } else {
      if (!episode?.shotIds?.length) throw new Error('请先完成镜头规划')
      const [images, videos] = await call(shotPromptRequests(project, episode))
      revision = { kind: 'shot_prompts', payload: mergeShotPrompts(project, episode, images, videos), sourceRefs }
    }
    await checkpoint('proposal', { proposal: revision })
  }
  const execute = async (type, payload, suffix) => projects.execute({ projectId, type, payload,
    expectedRevision: (await projects.getProject(projectId)).revision, commandId: `${task.id}:${suffix}`, actor: 'production-coordinator' })
  const submitted = await execute('submitDevelopmentProposal', { ...revision, proposalId: `${task.id}:proposal` }, 'submit')
  await execute('recordReviewDecision', { reviewTaskId: submitted.output.reviewTaskId, decision: 'approved', answerer: 'production-coordinator', reason: '用户请求编写，结构与输入版本通过校验' }, 'approve')
  return { summary: { proposalId: submitted.output.proposalId } }
}
