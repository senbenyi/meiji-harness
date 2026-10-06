import { validateDevelopmentPayload } from './contracts.js'

const string = { type: 'string' }
const array = (items) => ({ type: 'array', items })
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const citation = object({ sourceId: string, start: { type: 'integer' }, end: { type: 'integer' } })
const entity = object({ id: string, name: string, description: string })
const beat = object({ id: string, description: string, sourceSpans: array(citation) })
const binding = object({ kind: string, entityId: string })
const shot = object({ id: string, order: { type: 'integer' }, duration: { type: 'number' }, title: string, shotDescription: string, prompt: string, audioDialogue: string, audioNotes: string, beatIds: array(string), referenceBindings: array(binding) })
export const NOVEL_SCHEMAS = {
  summary: object({ facts: array(string), characters: array(entity), locations: array(entity), beats: array(beat), citations: array(citation), openConflicts: array(string) }),
  analysis: object({ summary: string, storyBible: { type: 'object', additionalProperties: true }, characters: array(entity), locations: array(entity), beats: array(beat), citations: array(citation) }),
  plan: object({ episodes: array(object({ id: string, order: { type: 'integer' }, title: string, outline: string, beatIds: array(string), sourceSpans: array(citation) })) }),
  script: object({ episodeId: string, script: string, sourceSpans: array(citation), shots: array(shot) }),
}

/** Persist foreground text tasks so recovery reuses valid child results. */
export async function novelTextProduction({ projects, projectId, sourceId, contentHash, segments, schemas, runWorkflow, onProposal = async () => {} }) {
  const textRunId = `${projectId}:text:${contentHash.slice(0,12)}`
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
  const summaries = segments.map((segment, index) => ({ id: id(`source-summary:${index}`), kind: 'novel-text', dependencies: [], input: { label: `source-summary:${index}`, phase: '分段分析' } }))
  await ensureRun(textRunId, [...summaries,
    { id: id('story-reconcile'), kind: 'novel-text', dependencies: summaries.map((task) => task.id), input: { label: 'story-reconcile', phase: '故事归并' } },
    { id: id('episode-plan'), kind: 'novel-text', dependencies: [id('story-reconcile')], input: { label: 'episode-plan', phase: '故事归并' } },
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
      pending.push({ ...request, label: task.input.label, phase: task.input.phase })
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
  for (let offset = 0; offset < segments.length; offset += 3) {
    const requests = segments.slice(offset, offset + 3).map((segment, index) => ({
      id: id(`source-summary:${offset + index}`), schema: schemas.summary,
      validate: (value) => {
        if (!value.beats?.length || !value.citations?.length || value.citations.some((span) => span.sourceId !== sourceId || span.start < segment.start || span.end > segment.end)) throw new Error('分段摘要缺少事件或引用了区间外原文')
      },
      prompt: `分析原文区间 ${segment.start}..${segment.end}。每条 citation 引用 ${sourceId}，事件必须有稳定 id；角色与场景必须有稳定 id/name 和视觉描述。原文：\n${segment.text}`,
    }))
    sourceSummaries.push(...await runBatch(requests))
  }
  const [analysis] = await runBatch([{ id: id('story-reconcile'), schema: schemas.analysis, validate: (value) => {
    validateDevelopmentPayload('content_analysis', value)
    const ids = new Set((value.beats || []).map((beat) => beat.id))
    if (!ids.size || sourceSummaries.flatMap((summary) => summary.beats).some((beat) => !ids.has(beat.id))) throw new Error('故事归并遗漏原文事件')
  }, prompt: `归并为完整内容分析；保留所有关键事件及其稳定 id、来源区间，不重命名事件 id；人物和场景保留稳定 id/name 和视觉描述。摘要：${JSON.stringify(sourceSummaries)}` }])
  await onProposal('content_analysis', analysis)
  const [episodePlan] = await runBatch([{ id: id('episode-plan'), schema: schemas.plan, validate: (value) => {
    validateDevelopmentPayload('episode_plan', value)
    assertNovelPlan(analysis, value, sourceId, segments.at(-1).end)
  }, prompt: `根据全部事件规划覆盖整书的分集，不设置固定集数上限。每集 beatIds 指定负责的事件 id；全部关键事件必须分配。sourceSpans 引用 ${sourceId}。内容分析：${JSON.stringify(analysis)}` }])
  if (!episodePlan.episodes?.length) throw new Error('分集规划为空')
  await onProposal('episode_plan', episodePlan)
  const scriptRunId = `${textRunId}:scripts`
  const scriptTasks = episodePlan.episodes.map((episode) => ({ id: `${scriptRunId}:${episode.id}`, kind: 'novel-text', scopeId: episode.id, dependencies: [id('episode-plan')], input: { label: `episode-script:${episode.id}`, phase: '分集写作' } }))
  await ensureRun(scriptRunId, scriptTasks)
  const episodeScripts = []
  for (let offset = 0; offset < episodePlan.episodes.length; offset += 3) {
    const requests = episodePlan.episodes.slice(offset, offset + 3).map((episode, index) => {
      const sourceText = (episode.sourceSpans || []).map((span) => segments.map((segment) => {
        const start = Math.max(span.start, segment.start), end = Math.min(span.end, segment.end)
        return end > start ? segment.text.slice(start - segment.start, end - segment.start) : ''
      }).join('')).join('\n')
      return { id: scriptTasks[offset + index].id, schema: schemas.script, validate: (value) => {
        validateDevelopmentPayload('episode_script', value)
        if (value.episodeId !== episode.id) throw new Error('子 Agent 返回了错误的分集 id')
        assertEpisodeCoverage(analysis, episode, value)
      }, prompt: `生成完整正式剧本与逐镜计划，不设置固定镜头数上限；每镜最多 8 秒，长对白或动作必须拆镜，按正常语速为对白留足时间。每个事件必须落实到 shots.beatIds；每镜 referenceBindings 指向分析中的稳定角色和场景 id，kind 只能为 character/location，entityId 必须存在。每镜填写具体 shotDescription、短版 H3 六项 prompt、audioDialogue（每行说话人：原文台词，无对白为空字符串）及 audioNotes。不得用大纲或通用镜头替代正式剧本。故事圣经：${JSON.stringify(analysis.storyBible)}；角色：${JSON.stringify(analysis.characters)}；场景：${JSON.stringify(analysis.locations)}；本集：${JSON.stringify(episode)}；本集原文：\n${sourceText}` }
    })
    const scripts = await runBatch(requests)
    for (const script of scripts) await onProposal('episode_script', script)
    episodeScripts.push(...scripts)
  }
  return { analysis, episodePlan, episodeScripts, segmentCount: sourceSummaries.length, textRunId, scriptRunId }
}

/** Validate semantic coverage before approving any production proposal. */
export function assertNovelCoverage(value, sourceId, characters) {
  assertNovelPlan(value.analysis, value.episodePlan, sourceId, characters)
  const episodes = value.episodePlan.episodes
  const scripts = value.episodeScripts || []
  if (scripts.length !== episodes.length || new Set(scripts.map((script) => script.episodeId)).size !== episodes.length) throw new Error('分集剧本不完整')
  for (const episode of episodes) assertEpisodeCoverage(value.analysis, episode, scripts.find((script) => script.episodeId === episode.id))
}

function assertNovelPlan(analysis, episodePlan, sourceId, characters) {
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

function assertEpisodeCoverage(analysis, episode, script) {
  if (!script?.shots?.length || script.script === episode.outline) throw new Error(`正式剧本缺失或被大纲替代：${episode.id}`)
  const shotBeats = new Set(script.shots.flatMap((shot) => shot.beatIds || []))
  if (episode.beatIds.some((id) => !shotBeats.has(id))) throw new Error(`分镜未覆盖本集事件：${episode.id}`)
  for (const shot of script.shots) {
    if (!shot.beatIds?.length || shot.beatIds.some((id) => !episode.beatIds.includes(id))) throw new Error(`镜头缺少本集事件关联：${shot.id}`)
    const bindings = shot.referenceBindings || []
    if (!bindings.some((binding) => binding.kind === 'location') || (analysis.characters.length && !bindings.some((binding) => binding.kind === 'character'))) throw new Error(`镜头缺少角色／场景设定：${shot.id}`)
    for (const binding of bindings) {
      const entities = binding.kind === 'character' ? analysis.characters : binding.kind === 'location' ? analysis.locations : []
      if (!entities.some((entity) => entity.id === binding.entityId)) throw new Error(`镜头引用未知设定：${binding.entityId}`)
    }
  }
}
