import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { FileService } from '../../lib/storage/files.js'
import { SourceTextService } from '../../lib/script/source-service.js'
import { reviewQueue } from '../../lib/domain/read-models.js'
import { makeScriptDevelopmentTools } from '../../lib/script/tools.js'
import { installNovelChildPolicy } from '../../lib/script/child-policy.js'

async function fixture() {
  const service = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await service.createProject({ payload: { title: '文本开发' } })
  return { service, projectId: created.project.id }
}

async function command(service, projectId, type, payload, commandId = randomUUID()) {
  const project = await service.getProject(projectId)
  return service.execute({ projectId, commandId, expectedRevision: project.revision, type, payload, actor: 'test' })
}

async function registerSource(service, projectId) {
  await command(service, projectId, 'registerSourceDocument', {
    sourceId: 'source-1', title: '原文', format: 'text', logicalKey: `source/${projectId}/source-1.txt`,
    contentHash: 'a'.repeat(64), bytes: 1000, characters: 1000,
  })
  return [{ sourceId: 'source-1', contentHash: 'a'.repeat(64) }]
}

async function decide(service, projectId, reviewTaskId, decision = 'approved') {
  return command(service, projectId, 'recordReviewDecision', { reviewTaskId, decision, answerer: 'tester' })
}

test('SourceTextService imports immutable normalized text and reads verified chunks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-source-'))
  try {
    const { service, projectId } = await fixture()
    const files = await new FileService(root).initialize()
    const sources = new SourceTextService({ projectService: service, fileService: files })
    const commandId = randomUUID()
    const imported = await sources.importText({ projectId, sourceId: 'novel', commandId, title: '小说', format: 'txt', text: '\uFEFF第一行\r\n第二行🙂' })
    assert.equal(imported.project.sourceDocuments.novel.characters, '第一行\n第二行🙂'.length)

    const first = await sources.readChunk({ projectId, sourceId: 'novel', cursor: 0, limit: 4 })
    const second = await sources.readChunk({ projectId, sourceId: 'novel', cursor: first.end, limit: 100 })
    assert.equal(first.text + second.text, '第一行\n第二行🙂')
    assert.equal(second.eof, true)

    const repeated = await sources.importText({ projectId, sourceId: 'novel', commandId, title: '小说', format: 'txt', text: '\uFEFF第一行\r\n第二行🙂' })
    assert.equal(repeated.project.revision, imported.project.revision)
    await assert.rejects(
      sources.importText({ projectId, sourceId: 'novel', title: '小说', text: '不同内容' }),
      /immutable/,
    )
    await assert.rejects(sources.importText({ projectId, sourceId: '../escape', title: '越界', text: '内容' }), /safe storage identifiers/)
    const logicalKey = imported.project.sourceDocuments.novel.logicalKey
    assert.match(logicalKey, new RegExp(`^artifacts/${projectId}/step-01-source/step-01-novel-小说\\.txt$`))
    assert.equal(await files.readText(logicalKey), '第一行\n第二行🙂')
    await files.replace(logicalKey, '被篡改')
    await assert.rejects(sources.readChunk({ projectId, sourceId: 'novel' }), /hash mismatch/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('approved proposals materialize analysis, episode plan and formal script in order', async () => {
  const { service, projectId } = await fixture()
  const sourceRefs = await registerSource(service, projectId)

  const analysis = await command(service, projectId, 'submitDevelopmentProposal', {
    proposalId: 'analysis-1', kind: 'content_analysis', sourceRefs,
    payload: {
      summary: '主角寻找失踪的姐姐。', storyBible: { premise: '寻找亲人' },
      characters: [{ id: 'character-lin', name: '林夏', description: '调查员' }],
      locations: [{ id: 'location-station', name: '旧车站', layout: '废弃站台' }],
      beats: [{ label: '收到线索' }], citations: [{ sourceId: 'source-1', start: 0, end: 100 }],
    },
  })
  assert.equal(analysis.project.storyBible, null)
  assert.equal(reviewQueue(analysis.project)[0].target.kind, 'content_analysis')
  await decide(service, projectId, analysis.output.reviewTaskId)
  let project = await service.getProject(projectId)
  assert.equal(project.storyBible.summary, '主角寻找失踪的姐姐。')
  assert.equal(project.characters['character-lin'].name, '林夏')
  assert.equal(project.developmentProposals['analysis-1'].status, 'approved')

  const plan = await command(service, projectId, 'submitDevelopmentProposal', {
    proposalId: 'plan-1', kind: 'episode_plan', sourceRefs,
    payload: { episodes: [{ id: 'episode-1', order: 1, title: '失踪', outline: '林夏抵达旧车站。', sourceSpans: [{ sourceId: 'source-1', start: 100, end: 300 }] }] },
  })
  await decide(service, projectId, plan.output.reviewTaskId)
  project = await service.getProject(projectId)
  assert.equal(project.episodes['episode-1'].outline, '林夏抵达旧车站。')

  const script = await command(service, projectId, 'submitDevelopmentProposal', {
    proposalId: 'script-1', kind: 'episode_script', sourceRefs,
    payload: {
      episodeId: 'episode-1', script: '林夏走进车站，听见广播。',
      sourceSpans: [{ sourceId: 'source-1', start: 100, end: 500 }],
      shots: [
        { id: 'draft-1', order: 1, title: '进入车站', duration: 5, shotDescription: '林夏走入废弃站台。', audioDialogue: null },
        { id: 'draft-2', order: 2, title: '广播响起', duration: 5, shotDescription: '镜头推近旧广播。', audioDialogue: '请立即离开。', continuityFrom: 'draft-1' },
      ],
    },
  })
  project = await service.getProject(projectId)
  assert.equal(project.episodes['episode-1'].script, undefined)
  assert.deepEqual(project.episodes['episode-1'].shotIds, [])

  await decide(service, projectId, script.output.reviewTaskId)
  project = await service.getProject(projectId)
  const [firstId, secondId] = project.episodes['episode-1'].shotIds
  assert.equal(project.episodes['episode-1'].script, '林夏走进车站，听见广播。')
  assert.equal(project.shots[firstId].status, 'planned')
  assert.equal(project.shots[secondId].continuityFrom, firstId)
  assert.equal(project.shots[secondId].audioDialogue, '请立即离开。')
  assert.equal(project.developmentProposals['script-1'].status, 'approved')
})

test('script proposal tools accept native objects and auto-approve atomically', async () => {
  const { service, projectId } = await fixture()
  await registerSource(service, projectId)
  const tools = makeScriptDevelopmentTools({ projectService: service })
  const submit = tools.find((tool) => tool.name === 'studio_content_analysis_submit')
  assert.equal(submit.parameters.properties.payload.type, 'object')
  assert.equal(submit.parameters.properties.sourceRefs.type, 'array')

  const project = await service.getProject(projectId)
  const response = await submit.execute({
    projectId,
    revision: project.revision,
    commandId: 'native-object-auto-approve',
    autoApprove: true,
    payload: {
      summary: '原生对象载荷', storyBible: { premise: '可靠提交' }, characters: [], locations: [], beats: [],
      citations: [{ sourceId: 'source-1', start: 0, end: 10 }],
    },
  })
  assert.equal(response.ok, true, response.error)
  assert.equal(JSON.parse(response.json).approved, true)
  const updated = await service.getProject(projectId)
  assert.equal(updated.storyBible.summary, '原生对象载荷')
  assert.equal(Object.values(updated.developmentProposals)[0].status, 'approved')
})

test('script tools throw terminal input errors instead of returning ok false', async () => {
  const { service } = await fixture()
  const tools = makeScriptDevelopmentTools({
    projectService: service,
    sourceServiceFor: async () => ({ readChunk: async () => { throw new Error('project not found: missing') } }),
  })
  const read = tools.find((tool) => tool.name === 'studio_source_read')
  await assert.rejects(
    read.execute({ projectId: 'missing', sourceId: 'novel', cursor: 0, limit: 100 }),
    (error) => error.code === 'INVALID_REQUEST' && error.retryable === false,
  )
})

test('novel child policy isolates tools and enforces structured output and step budgets', async () => {
  let restriction
  let guard
  let preStep
  const agent = { ctx: {
    tools: {
      restrict: (value) => { restriction = value },
      guard: (value) => { guard = value },
    },
    on: (name, listener) => { if (name === 'agent/pre-step') preStep = listener },
  } }
  installNovelChildPolicy(agent)
  assert.deepEqual(restriction, { allow: [] })
  assert.match(guard({ name: 'studio_source_read' }), /cannot call/)
  assert.equal(guard({ name: 'structured_output' }), undefined)
  assert.equal(guard({ name: 'structured_output' }), undefined)
  assert.match(guard({ name: 'structured_output' }), /exceeded/)
  assert.deepEqual(await preStep({ step: 7 }, async () => ({ kind: 'enter' })), { kind: 'reject' })
  assert.deepEqual(await preStep({ step: 6 }, async () => ({ kind: 'enter' })), { kind: 'enter' })
})

test('rejected or invalid proposals never mutate canonical project data', async () => {
  const { service, projectId } = await fixture()
  const sourceRefs = await registerSource(service, projectId)
  const proposal = await command(service, projectId, 'submitDevelopmentProposal', {
    proposalId: 'analysis-rejected', kind: 'content_analysis', sourceRefs,
    payload: {
      summary: '候选摘要', storyBible: { premise: '候选' }, characters: [], locations: [], beats: [],
      citations: [{ sourceId: 'source-1', start: 0, end: 10 }],
    },
  })
  await decide(service, projectId, proposal.output.reviewTaskId, 'rejected')
  const project = await service.getProject(projectId)
  assert.equal(project.storyBible, null)
  assert.equal(project.developmentProposals['analysis-rejected'].status, 'rejected')

  await assert.rejects(
    command(service, projectId, 'submitDevelopmentProposal', {
      kind: 'episode_plan', sourceRefs,
      payload: { episodes: [{ id: 'bad', order: 1, title: '越界', outline: '越界引用', sourceSpans: [{ sourceId: 'source-1', start: 0, end: 1001 }] }] },
    }),
    /exceeds source length/,
  )
})

test('approving a replacement script invalidates old shots and downstream assets', async () => {
  const { service, projectId } = await fixture()
  const sourceRefs = await registerSource(service, projectId)
  await command(service, projectId, 'upsertEpisode', { id: 'episode-1', title: '旧剧本' })
  await command(service, projectId, 'upsertShot', { id: 'old-shot', episodeId: 'episode-1', title: '旧镜头', status: 'ready' })
  let project = await service.getProject(projectId)
  project.assets['old-asset'] = { id: 'old-asset', status: 'candidate', dependsOn: ['old-shot'] }
  await service.repository.put(project)

  const proposal = await command(service, projectId, 'submitDevelopmentProposal', {
    proposalId: 'replacement', kind: 'episode_script', sourceRefs,
    payload: {
      episodeId: 'episode-1', script: '新剧本', sourceSpans: [{ sourceId: 'source-1', start: 0, end: 100 }],
      shots: [{ order: 1, title: '新镜头', duration: 5, shotDescription: '新画面。' }],
    },
  })
  await decide(service, projectId, proposal.output.reviewTaskId)
  project = await service.getProject(projectId)
  assert.equal(project.shots['old-shot'].status, 'invalidated')
  assert.equal(project.assets['old-asset'].status, 'invalidated')
  assert.deepEqual(project.episodes['episode-1'].shotIds, ['episode-1-script-v001-shot-001'])
})

test('approving a changed episode plan clears stale formal script and invalidates its downstream', async () => {
  const { service, projectId } = await fixture()
  const sourceRefs = await registerSource(service, projectId)
  await command(service, projectId, 'upsertEpisode', { id: 'episode-1', order: 1, title: '旧标题', outline: '旧大纲', script: '旧剧本' })
  await command(service, projectId, 'upsertShot', { id: 'old-shot', episodeId: 'episode-1', title: '旧镜头', status: 'ready' })

  const proposal = await command(service, projectId, 'submitDevelopmentProposal', {
    proposalId: 'replan', kind: 'episode_plan', sourceRefs,
    payload: { episodes: [{ id: 'episode-1', order: 1, title: '新标题', outline: '新大纲', sourceSpans: [{ sourceId: 'source-1', start: 0, end: 100 }] }] },
  })
  await decide(service, projectId, proposal.output.reviewTaskId)
  const project = await service.getProject(projectId)
  assert.equal(project.episodes['episode-1'].script, null)
  assert.deepEqual(project.episodes['episode-1'].shotIds, [])
  assert.equal(project.shots['old-shot'].status, 'invalidated')
})
