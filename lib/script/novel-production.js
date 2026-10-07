import { validateDevelopmentPayload } from './contracts.js'
import { extractAssetsByEpisode, assetScriptRefs, assetPromptRequests, applyAssetPrompts } from './asset-production.js'
import { shotPromptRequests, mergeShotPromptResults } from './shot-production.js'
import { NOVEL_SCHEMAS, NOVEL_SCHEMA_PARTS } from './production-schemas.js'
import { bundledProductionPipelineCompiler } from '../production/pipeline-compiler.js'

const array = (items) => ({ type: 'array', items })
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const { citation, shot } = NOVEL_SCHEMA_PARTS

export { NOVEL_SCHEMAS }

export function episodeDraftSchema(episode) {
  return { ...NOVEL_SCHEMAS.script, properties: { ...NOVEL_SCHEMAS.script.properties,
    episodeId: { type: 'string', const: episode.id }, beatIds: { type: 'array', items: { type: 'string', enum: episode.beatIds }, description: `原样返回 ${JSON.stringify(episode.beatIds)}` },
    sourceSpans: { type: 'array', items: citation, description: `只能原样返回此数组，不添加细分区间：${JSON.stringify(episode.sourceSpans)}` },
  } }
}

export function episodeStoryboardSchema(assets, episode) {
  const choices = Object.entries({ character: 'characters', location: 'locations', prop: 'props', variant: 'assetVariants' })
    .filter(([, collection]) => assets[collection]?.length).map(([kind, collection]) => object({ kind: { type: 'string', const: kind }, entityId: { type: 'string', enum: assets[collection].map((entity) => entity.id) } }))
  return object({ episodeId: { type: 'string', const: episode.id }, shots: array({ ...shot, properties: { ...shot.properties,
    beatIds: array({ type: 'string', enum: episode.beatIds }), referenceBindings: array({ oneOf: choices }),
  } }) })
}

/** Persist foreground text tasks so recovery reuses valid child results. */
export async function novelTextProduction({ projects, projectId, sourceId, contentHash, segments, runWorkflow, onProposal = async () => {} }) {
  const compiler = bundledProductionPipelineCompiler()
  const textRunId = `${projectId}:text:${contentHash.slice(0,12)}:${compiler.pipeline.id}-v${compiler.pipeline.version}`
  const execute = async (type, payload) => {
    const project = await projects.getProject(projectId)
    return projects.execute({ projectId, expectedRevision: project.revision, commandId: `${textRunId}:${type}:${project.revision}`, type, payload, actor: 'novel-text' })
  }
  const ensureRun = async (runId, tasks) => {
    const project = await projects.getProject(projectId)
    const run = project.productionRuns[runId]
    if (!run) await execute('createProductionRun', { runId, sourceId, mode: 'text', tasks })
    else if (run.status !== 'completed') await execute('resumeProductionRun', { runId })
  }
  const id = (label) => `${textRunId}:${label}`
  const summaries = segments.map((_segment, index) => compiler.task('source-summary', { id: id(`source-summary:${index}`), label: `source-summary:${index}` }))
  await ensureRun(textRunId, [...summaries,
    compiler.task('story-reconcile', { id: id('story-reconcile'), label: 'story-reconcile', dependencies: summaries.map((task) => task.id) }),
    compiler.task('episode-plan', { id: id('episode-plan'), label: 'episode-plan', dependencies: [id('story-reconcile')] }),
  ])
  const runBatch = async (requests) => {
    const pending = []
    const values = new Map()
    for (const request of requests) {
      const project = await projects.getProject(projectId)
      const task = project.productionTasks[request.id]
      if (task.status === 'completed') { request.validate?.(task.outputRef); values.set(request.id, task.outputRef); continue }
      await execute('leaseProductionTask', { taskId: task.id, owner: 'novel-text', leaseMs: 1800000 })
      await execute('startProductionTask', { taskId: task.id, owner: 'novel-text' })
      const previousError = task.error || task.lastError
      pending.push({ ...request, prompt: request.prompt + (previousError ? `\n上次结果未通过流程校验：${previousError}。本次必须修正该字段错误，再提交完整结构化结果。` : ''), role: task.input.role, label: task.input.label, phase: task.input.phase })
    }
    if (pending.length) {
      let results = []
      let workflowError
      try { results = await runWorkflow(pending) } catch (error) { workflowError = error.message }
      for (const request of pending) {
        const result = results.find((item) => item?.label === request.label)
        let error = workflowError || result?.error
        if (result?.value && !error) {
          try { request.validate?.(result.value) } catch (invalid) { error = invalid.message }
        }
        if (result?.value && !error) {
          await execute('completeProductionTask', { taskId: request.id, owner: 'novel-text', outputRef: result.value })
          values.set(request.id, result.value)
        } else await execute('failProductionTask', { taskId: request.id, owner: 'novel-text', error: error || `文本子任务未返回合法结构化结果：${request.label}` })
      }
      const missing = pending.filter((request) => !values.has(request.id))
      if (missing.length) throw new Error(`文本制作失败，保留任务以便恢复：${missing.map((request) => request.label).join(', ')}`)
    }
    return requests.map((request) => values.get(request.id))
  }
  const sourceSummaries = []
  let summaryOffset = 0
  for (const segmentBatch of compiler.batches('source-summary', segments)) {
    const requests = segmentBatch.map((segment, index) => compiler.request('source-summary', {
      id: id(`source-summary:${summaryOffset + index}`),
      validate: (value) => {
        if (!value.beats?.length || !value.citations?.length || value.citations.some((span) => span.sourceId !== sourceId || span.start < segment.start || span.end > segment.end)) throw new Error('分段摘要缺少事件或引用了区间外原文')
      },
      prompt: `分析原文区间 ${segment.start}..${segment.end}。每条 citation 引用 ${sourceId}，事件必须有稳定 id；角色与场景必须有稳定 id/name 和原文事实描述，不自行设计造型。原文：\n${segment.text}`,
    }))
    sourceSummaries.push(...await runBatch(requests))
    summaryOffset += segmentBatch.length
  }
  const [analysis] = await runBatch([compiler.request('story-reconcile', { id: id('story-reconcile'), validate: (value) => {
    validateDevelopmentPayload('content_analysis', value)
    const ids = new Set((value.beats || []).map((beat) => beat.id))
    if (!ids.size || sourceSummaries.flatMap((summary) => summary.beats).some((beat) => !ids.has(beat.id))) throw new Error('故事归并遗漏原文事件')
  }, prompt: `归并为完整内容分析；保留所有关键事件及其稳定 id、来源区间，不重命名事件 id；人物和场景保留稳定 id/name 和原文事实描述。摘要：${JSON.stringify(sourceSummaries)}` })])
  await compiler.commit('story-reconcile', analysis, onProposal)
  const sourceEnd = segments.at(-1).end
  const minimumEpisodes = Math.max(1, Math.ceil(sourceEnd / 800))
  const [episodePlan] = await runBatch([compiler.request('episode-plan', { id: id('episode-plan'), validate: (value) => {
    materializeEpisodeSourceSpans(value, analysis, sourceId, sourceEnd)
    validateDevelopmentPayload('episode_plan', value)
    assertNovelPlan(analysis, value, sourceId, sourceEnd)
    if (value.episodes.length < minimumEpisodes) throw new Error(`分集过度压缩：至少需要 ${minimumEpisodes} 集`)
  }, prompt: `根据全部事件规划覆盖整书的分集，本次至少 ${minimumEpisodes} 集，不设置固定集数上限。episodes、每集 beatIds 和 sourceSpans 都不得为空；分集 id 与 order 必须唯一，order 使用正整数。每集 beatIds 指定负责的事件 id，全部关键事件必须且只能分配到分集。全集 sourceSpans 引用 ${sourceId}，并集必须从 0 到 ${sourceEnd} 连续覆盖完整原文，不得留空隙；标题、空白和过渡文字也必须并入相邻集。内容分析：${JSON.stringify(analysis)}` })])
  if (!episodePlan.episodes?.length) throw new Error('分集规划为空')
  await compiler.commit('episode-plan', episodePlan, onProposal)
  const plannedEpisodeIds = episodePlan.episodes.map((episode) => episode.id).sort()
  const formalEpisodeIds = Object.keys((await projects.getProject(projectId)).episodes).filter((episodeId) => episodeId !== 'legacy-main').sort()
  if (JSON.stringify(formalEpisodeIds) !== JSON.stringify(plannedEpisodeIds)) throw new Error('分集规划物化结果与当前流水线版本不一致')
  const scriptRunId = `${textRunId}:scripts`
  const assetTaskId = `${scriptRunId}:asset-extraction`
  const extractionIds = episodePlan.episodes.map((episode) => `${assetTaskId}:${episode.id}`)
  const scriptTasks = episodePlan.episodes.flatMap((episode) => [
    compiler.task('episode-script', { id: `${scriptRunId}:${episode.id}`, scopeId: episode.id, dependencies: [id('episode-plan')], label: `episode-script:${episode.id}` }),
    compiler.task('shot-plan', { id: `${scriptRunId}:${episode.id}:storyboard`, scopeId: episode.id, dependencies: [`${scriptRunId}:${episode.id}`, ...extractionIds], label: `episode-storyboard:${episode.id}` }),
  ])
  scriptTasks.push(...episodePlan.episodes.map((episode, index) => compiler.task('asset-extraction', { id: extractionIds[index], dependencies: [`${scriptRunId}:${episode.id}`, ...(index ? [extractionIds[index - 1]] : [])], label: `asset-extraction:${episode.id}` })))
  await ensureRun(scriptRunId, scriptTasks.filter((task) => task.input.role !== 'shot'))
  const episodeScripts = []
  const allDrafts = []
  const draftProposals = []
  for (const episodeBatch of compiler.batches('episode-script', episodePlan.episodes)) {
    const requests = episodeBatch.map((episode) => {
      const sourceText = (episode.sourceSpans || []).map((span) => segments.map((segment) => {
        const start = Math.max(span.start, segment.start), end = Math.min(span.end, segment.end)
        return end > start ? segment.text.slice(start - segment.start, end - segment.start) : ''
      }).join('')).join('\n')
      return compiler.request('episode-script', { id: `${scriptRunId}:${episode.id}`, schema: episodeDraftSchema(episode),
        validate: (value) => assertEpisodeDraft(episode, value),
        prompt: `只生成本集完整正式剧本、动作和对白，不生成 shots。beatIds 必须覆盖本集全部事件，sourceSpans 沿用本集来源。不得用大纲代替剧本。故事圣经：${JSON.stringify(analysis.storyBible)}；本集：${JSON.stringify(episode)}；本集原文：\n${sourceText}` })
    })
    const drafts = await runBatch(requests)
    for (const draft of drafts) draftProposals.push(await compiler.commit('episode-script', draft, onProposal))
    allDrafts.push(...drafts)
  }
  const formal = await projects.getProject(projectId)
  const formalEpisodes = episodePlan.episodes.map((ep) => formal.episodes[ep.id])
  const assets = await extractAssetsByEpisode(formalEpisodes, formal, (requests) => runBatch(requests.map((request) => compiler.request('asset-extraction', { ...request, id: `${scriptRunId}:${request.label}` }))))
  const assetPromptIds = []
  for (const variants of [false, true]) {
    const requests = assetPromptRequests(assets, formalEpisodes, variants).map((request) => compiler.request('asset-prompt', { ...request, id: `${scriptRunId}:${request.label}` }))
    if (!requests.length) continue
    await ensureRun(`${scriptRunId}:asset-prompts:${variants ? 'variants' : 'base'}`, requests.map((request) => compiler.task('asset-prompt', { id: request.id, dependencies: variants ? [...assetPromptIds] : extractionIds, label: request.label })))
    for (const batch of compiler.batches('asset-prompt', requests)) {
      applyAssetPrompts(assets, batch, await runBatch(batch))
    }
    assetPromptIds.push(...requests.map((request) => request.id))
  }
  await compiler.commit('asset-commit', { ...assets, scriptRefs: assetScriptRefs(formalEpisodes) }, onProposal)
  await ensureRun(`${scriptRunId}:shots`, scriptTasks.filter((task) => task.input.role === 'shot').map((task) => ({ ...task,
    dependencies: task.input.role === 'shot' && task.input.label.startsWith('episode-storyboard:') ? [...task.dependencies, ...assetPromptIds] : task.dependencies,
  })))
  let draftOffset = 0
  for (const drafts of compiler.batches('shot-plan', allDrafts)) {
    const boards = await runBatch(drafts.map((draft) => {
      const episode = episodePlan.episodes.find((item) => item.id === draft.episodeId)
      return compiler.request('shot-plan', { id: `${scriptRunId}:${episode.id}:storyboard`, schema: episodeStoryboardSchema(assets, episode),
        validate: (board) => assertStoryboard({ ...analysis, ...assets }, episode, draft, board),
        prompt: storyboardPrompt(analysis, assets, episode, draft),
      })
    }))
    for (const [index, board] of boards.entries()) {
      const script = { ...drafts[index], shots: board.shots, ...(draftProposals[draftOffset + index]?.proposalId ? { draftProposalId: draftProposals[draftOffset + index].proposalId } : {}) }
      await compiler.commit('shot-plan', script, onProposal)
      const current = await projects.getProject(projectId)
      const episode = current.episodes[script.episodeId]
      const requests = shotPromptRequests(current, episode).map((request) => compiler.request(request.purpose === 'image' ? 'storyboard-prompt' : 'video-prompt', { ...request, id: `${scriptRunId}:${request.label}` }))
      await ensureRun(`${scriptRunId}:prompts:${episode.id}`, requests.map((request) => compiler.task(request.pipelineNodeId, { id: request.id, scopeId: request.shotId, dependencies: [`${scriptRunId}:${episode.id}:storyboard`], label: request.label })))
      const valuesByLabel = new Map()
      for (const nodeId of ['storyboard-prompt', 'video-prompt']) {
        const nodeRequests = requests.filter((request) => request.pipelineNodeId === nodeId)
        for (const batch of compiler.batches(nodeId, nodeRequests)) {
          const batchValues = await runBatch(batch)
          batch.forEach((request, valueIndex) => valuesByLabel.set(request.label, batchValues[valueIndex]))
        }
      }
      const values = requests.map((request) => valuesByLabel.get(request.label))
      await compiler.commit('shot-prompts-commit', mergeShotPromptResults(current, episode, requests, values), onProposal)
      episodeScripts.push(script)
    }
    draftOffset += drafts.length
  }
  return { analysis, assets, episodePlan, episodeScripts, segmentCount: sourceSummaries.length, textRunId, scriptRunId }
}

export function assertAssetDesign(analysis, value) {
  for (const key of ['characters', 'locations']) {
    if (!Array.isArray(value[key]) || JSON.stringify(value[key].map((item) => item.id).sort()) !== JSON.stringify(analysis[key].map((item) => item.id).sort())) throw new Error(`视觉设定必须保留完整 ${key} id`)
    if (value[key].some((item) => typeof item.visualDescription !== 'string' || !item.visualDescription.trim() || Object.keys(item).some((key) => !['id', 'visualDescription'].includes(key)))) throw new Error('角色 subagent 只能提交视觉描述')
  }
}

export function assertEpisodeDraft(episode, draft) {
  const normalized = validateDevelopmentPayload('episode_draft', draft)
  if (draft.episodeId !== episode.id) throw new Error('生成结果的分集不匹配')
  if (draft.script === episode.outline) throw new Error('正式剧本不能使用大纲替代')
  if (JSON.stringify([...new Set(draft.beatIds)].sort()) !== JSON.stringify([...episode.beatIds].sort())) throw new Error('正式剧本未覆盖本集事件')
  if (JSON.stringify(normalized.sourceSpans) !== JSON.stringify(episode.sourceSpans.map(({ sourceId, start, end }) => ({ sourceId, start, end })))) throw new Error('正式剧本来源区间必须原样沿用分集规划，不增加细分引用')
}

export function assertStoryboard(analysis, episode, draft, board) {
  if (board.episodeId !== episode.id || Object.keys(board).some((key) => !['episodeId', 'shots'].includes(key))) throw new Error('分镜 subagent 不得改写剧本或其他分集')
  validateDevelopmentPayload('episode_script', { ...draft, shots: board.shots })
  assertEpisodeCoverage(analysis, episode, { ...draft, shots: board.shots })
}

export function storyboardPrompt(analysis, assets, episode, draft) {
  const definitions = Object.fromEntries(Object.entries({ character: 'characters', location: 'locations', prop: 'props', variant: 'assetVariants' }).map(([kind, collection]) => [collection,
    (assets[collection] || []).map(({ id, name, description, parentKind, parentId, changes, preserve, usages }) => ({ kind, id, name, description, parentKind, parentId, changes, preserve, usages }))]))
  return `依据已定正式剧本规划完整镜头，只返回 episodeId 和 shots，不改写剧本。每镜最多8秒，长动作或对白必须拆镜，保留全部对白与事件。填写景别、机位、运动、画面、prompt（镜头意图草稿，后续单独编写完整图片与视频提示词）、audioDialogue（说话人：原文台词）和 audioNotes。shots.beatIds 关联本集事件，characterIds 与基础角色绑定一致，空镜明确 []，每镜绑定 location；涉及道具必须绑定 prop。衍生资产只能用 kind=variant，即使本体是场景或角色；同时保留本体绑定，每个本体只选择一个当前状态。不改变资产 id。事件：${JSON.stringify(analysis.beats)}；剧本资产（每项 kind 是绑定时必须原样使用的类型）：${JSON.stringify(definitions)}；分集：${JSON.stringify({ id: episode.id, beatIds: episode.beatIds })}；正式剧本：${JSON.stringify(draft)}`
}

/** Validate semantic coverage before approving any production proposal. */
export function assertNovelCoverage(value, sourceId, characters) {
  assertNovelPlan(value.analysis, value.episodePlan, sourceId, characters)
  const episodes = value.episodePlan.episodes
  const scripts = value.episodeScripts || []
  if (scripts.length !== episodes.length || new Set(scripts.map((script) => script.episodeId)).size !== episodes.length) throw new Error('分集剧本不完整')
  for (const episode of episodes) assertEpisodeCoverage({ ...value.analysis, ...value.assets }, episode, scripts.find((script) => script.episodeId === episode.id))
}

/** Derive exact episode source coverage from the model's beat assignment. */
export function materializeEpisodeSourceSpans(episodePlan, analysis, sourceId, sourceEnd) {
  const beats = new Map((analysis?.beats || []).map((beat) => [beat.id, beat]))
  const episodeStart = (episode) => Math.min(...(episode.beatIds || []).flatMap((id) => beats.get(id)?.sourceSpans || [])
    .filter((span) => span.sourceId === sourceId).map((span) => span.start))
  const episodes = [...(episodePlan?.episodes || [])].sort((a, b) => episodeStart(a) - episodeStart(b) || a.order - b.order)
  episodePlan.episodes = episodes
  let cursor = 0
  for (const [index, episode] of episodes.entries()) {
    episode.order = index + 1
    const spans = (episode.beatIds || []).flatMap((id) => beats.get(id)?.sourceSpans || [])
      .filter((span) => span.sourceId === sourceId && Number.isInteger(span.start) && Number.isInteger(span.end) && span.end > span.start)
    if (!spans.length) continue
    const beatEnd = Math.max(...spans.map((span) => span.end))
    const remaining = episodes.length - index - 1
    const end = index === episodes.length - 1 ? sourceEnd : Math.min(sourceEnd - remaining, Math.max(cursor + 1, beatEnd))
    episode.sourceSpans = [{ sourceId, start: cursor, end }]
    cursor = end
  }
  return episodePlan
}

export function assertNovelPlan(analysis, episodePlan, sourceId, characters) {
  const beats = analysis?.beats || []
  if (!beats.length || beats.some((beat) => !beat.id) || new Set(beats.map((beat) => beat.id)).size !== beats.length) throw new Error('内容分析缺少唯一关键事件 id')
  const episodes = episodePlan?.episodes || []
  if (!episodes.length) throw new Error('分集规划为空')
  const covered = new Set()
  const spans = []
  for (const episode of episodes) {
    for (const span of episode.sourceSpans || []) {
      if (span.sourceId !== sourceId || span.start < 0 || span.end > characters || span.end <= span.start) throw new Error(`分集来源区间无效：${episode.id}`)
      spans.push(span)
    }
    if (!episode.beatIds?.length || episode.beatIds.some((id) => !beats.some((beat) => beat.id === id))) throw new Error(`分集引用未知事件：${episode.id}`)
    for (const id of episode.beatIds) covered.add(id)
  }
  if (beats.some((beat) => !covered.has(beat.id))) throw new Error('分集规划遗漏关键事件')
  let cursor = 0
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    if (span.start > cursor) throw new Error(`分集规划遗漏原文区间：${cursor}..${span.start}`)
    cursor = Math.max(cursor, span.end)
  }
  if (cursor !== characters) throw new Error('分集规划未覆盖全部原文')
}

export function assertEpisodeCoverage(analysis, episode, script) {
  if (!script?.shots?.length || script.script === episode.outline) throw new Error(`正式剧本缺失或被大纲替代：${episode.id}`)
  const shotBeats = new Set(script.shots.flatMap((shot) => shot.beatIds || []))
  if (episode.beatIds.some((id) => !shotBeats.has(id))) throw new Error(`分镜未覆盖本集事件：${episode.id}`)
  for (const shot of script.shots) {
    if (!(shot.duration > 0 && shot.duration <= 8)) throw new Error(`镜头 ${shot.id} 的 duration 必须大于 0 且不超过 8 秒；长动作请拆镜`)
    if (!shot.beatIds?.length || shot.beatIds.some((id) => !episode.beatIds.includes(id))) throw new Error(`镜头缺少本集事件关联：${shot.id}`)
    const bindings = shot.referenceBindings || []
    const characterIds = shot.characterIds
    if (Array.isArray(characterIds) && (characterIds.some((id) => !analysis.characters.some((entity) => entity.id === id) || !bindings.some((binding) => binding.kind === 'character' && binding.entityId === id)) || bindings.some((binding) => binding.kind === 'character' && !characterIds.includes(binding.entityId)))) throw new Error(`镜头 ${shot.id} 的 characterIds 必须与角色参考绑定一致，空镜两者均为空`)
    if (!bindings.some((binding) => binding.kind === 'location') || (!Array.isArray(characterIds) && analysis.characters.length && !bindings.some((binding) => binding.kind === 'character'))) throw new Error(`镜头 ${shot.id} 的 referenceBindings 必须包含 kind=location 的场景绑定；有角色出镜时绑定对应 kind=character，空镜请明确 characterIds=[]；实际为 ${JSON.stringify(bindings)}`)
    for (const binding of bindings) {
      const entities = analysis[({ character: 'characters', location: 'locations', prop: 'props', variant: 'assetVariants' })[binding.kind]] || []
      if (!entities.some((entity) => entity.id === binding.entityId)) throw new Error(`镜头引用未知设定：kind=${binding.kind}, entityId=${binding.entityId}；衍生状态必须使用 kind=variant，同时保留本体绑定`)
      if (binding.kind === 'variant') {
        const variant = entities.find((entity) => entity.id === binding.entityId)
        if (!bindings.some((item) => item.kind === variant.parentKind && item.entityId === variant.parentId)) throw new Error(`衍生状态 ${variant.id} 缺少本体绑定 ${variant.parentKind}:${variant.parentId}`)
        if (bindings.filter((item) => item.kind === 'variant').filter((item) => analysis.assetVariants.some((entry) => entry.id === item.entityId && entry.parentId === variant.parentId && entry.parentKind === variant.parentKind)).length !== 1) throw new Error(`镜头 ${shot.id} 同一本体只能绑定一个衍生状态：${variant.parentId}`)
      }
    }
  }
}
