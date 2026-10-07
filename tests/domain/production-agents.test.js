import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { makeScriptDevelopmentTools } from '../../lib/script/tools.js'
import { NOVEL_SCHEMAS, novelTextProduction } from '../../lib/script/novel-production.js'
import { PRODUCTION_ROLES } from '../../lib/agents/roles.js'
import { PRODUCTION_WORKFLOW, runProductionWorkflow } from '../../lib/agents/workflow.js'
import { prepareMediaTask } from '../../lib/agents/media.js'
import { canvasReadModel } from '../../lib/domain/read-models.js'
import { extractedAssets, promptResponse, authorFixture, generation } from '../helpers/generation.js'
import { runCreativeTask } from '../../lib/script/creative-rework.js'
import { ProductionWorker } from '../../lib/production/worker.js'

const span = { sourceId: 'source', start: 0, end: 20 }
const analysis = { summary: 'A visitor finds a key.', storyBible: {}, characters: [{ id: 'visitor', name: 'Visitor', description: 'A visitor' }], locations: [{ id: 'room', name: 'Room', description: 'A room' }], beats: [{ id: 'key', sourceSpans: [span] }], citations: [span] }
const episode = { id: 'ep', order: 1, title: 'Key', outline: 'Find a key.', beatIds: ['key'], sourceSpans: [span] }
const draft = { episodeId: 'ep', script: 'The visitor enters the room and picks up a key.', beatIds: ['key'], sourceSpans: [span] }
const board = { episodeId: 'ep', shots: [{ id: 's', order: 1, title: 'Key', duration: 5, shotDescription: 'Visitor picks up the key.', prompt: 'Visitor picks up the key.', audioDialogue: '', audioNotes: 'Footsteps', beatIds: ['key'], characterIds: ['visitor'], referenceBindings: [{ kind: 'character', entityId: 'visitor' }, { kind: 'location', entityId: 'room' }] }] }
const visual = { characters: [{ id: 'visitor', visualDescription: 'A blue coat' }], locations: [{ id: 'room', visualDescription: 'A sunlit room' }] }

function fakeWorkflow(respond) {
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'phase', 'args', PRODUCTION_WORKFLOW)
  return { execute: async ({ args }) => ({ kind: 'foreground', agentsStarted: args.tasks.length, result: await run((prompt, options) => respond(prompt, options), (tasks) => Promise.all(tasks.map((task) => task())), () => {}, args) }) }
}

test('a task can persist successive text checkpoints under one phase and reuse identical checkpoints', async () => {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const { project } = await projects.createProject({ payload: { title: 'Checkpoint versions' } })
  const run = await projects.execute({ projectId: project.id, expectedRevision: project.revision, commandId: 'run', type: 'createProductionRun', payload: { runId: 'run', mode: 'text', tasks: [{ id: 'text', kind: 'revise-text', input: { kind: 'analysis' }, dependencies: [] }] } })
  const worker = new ProductionWorker({ projectService: projects, handlers: { 'revise-text': async ({ checkpoint }) => {
    await checkpoint('text-results', { textResults: { summary: 'one' } })
    await checkpoint('text-results', { textResults: { summary: 'one', analysis: 'two' } })
    await checkpoint('text-results', { textResults: { summary: 'one', analysis: 'two' } })
    return { summary: { done: true } }
  } } })
  await worker.runTask(project.id, run.project.productionTasks.text)
  const saved = (await projects.getProject(project.id)).productionTasks.text
  assert.equal(saved.status, 'completed', saved.error)
  assert.deepEqual(saved.checkpoint.textResults, { summary: 'one', analysis: 'two' })
})

test('asset authoring resumes individual valid prompts after a sibling fails', async () => {
  const project = { revision: 1, episodes: { ep: { ...episode, script: draft.script } }, characters: {}, locations: {}, props: {}, assetVariants: {}, developmentProposals: {} }
  const task = { id: 'author', scopeId: 'p', input: { phase: 'assets' }, checkpoint: {} }
  const calls = []
  let fail = true
  const projects = { getProject: async () => project, execute: async () => ({ output: { reviewTaskId: 'review', proposalId: 'proposal' } }) }
  const checkpoint = async (_name, value) => Object.assign(task.checkpoint, structuredClone(value))
  const runWorkflow = async (requests) => requests.map((request) => {
    calls.push(request.label)
    if (request.label.startsWith('asset-extraction:')) return { label: request.label, value: extractedAssets(analysis.characters, analysis.locations, 'ep', draft.script) }
    return { label: request.label, ...(fail && request.label === 'asset-prompt:visitor' ? { error: 'temporary failure' } : { value: generation() }) }
  })
  await assert.rejects(runCreativeTask({ projects, projectId: 'p', task, checkpoint, runWorkflow }), /temporary failure/)
  assert.ok(task.checkpoint.creativeResults['asset-prompt:room'], 'success after a failed sibling must still be checkpointed')
  fail = false
  calls.length = 0
  await runCreativeTask({ projects, projectId: 'p', task, checkpoint, runWorkflow })
  assert.deepEqual(calls, ['asset-prompt:visitor'])
  assert.ok(task.checkpoint.proposal.payload.characters[0].generation.prompt)
})

async function fixture() {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const { project } = await projects.createProject({ payload: { title: 'Role boundaries' } })
  const command = async (type, payload) => {
    const current = await projects.getProject(project.id)
    return projects.execute({ projectId: project.id, expectedRevision: current.revision, commandId: `${type}:${current.revision}`, type, payload })
  }
  await command('registerSourceDocument', { sourceId: 'source', title: 'Source', logicalKey: 'source.txt', contentHash: 'hash', bytes: 20, characters: 20 })
  const tools = makeScriptDevelopmentTools({ projectService: projects })
  const submit = async (kind, payload) => {
    const current = await projects.getProject(project.id)
    const value = await tools.find((tool) => tool.name === `studio_${kind}_submit`).execute({ projectId: project.id, revision: current.revision, payload, autoApprove: true, sourceRefs: [{ sourceId: 'source', contentHash: 'hash' }] })
    assert.equal(value.ok, true, value.error)
    return JSON.parse(value.json)
  }
  return { projects, projectId: project.id, command, submit }
}

test('professional text tasks materialize separate script and storyboard through domain commands', async () => {
  const f = await fixture()
  const roles = []
  const workflow = fakeWorkflow((prompt, options) => {
    const role = options.label.split(':')[0]
    roles.push(role)
    const label = options.label.slice(role.length + 1)
    return structuredClone(label.startsWith('asset-prompt:') ? generation() : label.includes('-prompts:') ? promptResponse({ label, prompt }) : label.startsWith('source-summary:') ? { ...analysis, facts: [], openConflicts: [] } : label === 'story-reconcile' ? analysis : label.startsWith('asset-extraction:') ? extractedAssets(analysis.characters, analysis.locations, 'ep', draft.script) : label === 'episode-plan' ? { episodes: [episode] } : label.startsWith('episode-storyboard:') ? board : draft)
  })
  const result = await novelTextProduction({ ...f, sourceId: 'source', contentHash: 'hash', segments: [{ start: 0, end: 20, text: 'A visitor finds key.' }], schemas: NOVEL_SCHEMAS,
    runWorkflow: async (tasks) => (await runProductionWorkflow(workflow, tasks, {})).result,
    onProposal: async (kind, payload) => {
      const saved = await f.submit(kind, payload)
      if (kind === 'episode_draft') {
        const p = await f.projects.getProject(f.projectId)
        assert.equal(p.episodes.ep.script, draft.script)
        assert.deepEqual(p.episodes.ep.shotIds, [])
        assert.equal(canvasReadModel(p).nodes.find((node) => node.id === 'domain:script:ep').status, 'ready')
      }
      return saved
    },
  })
  assert.deepEqual(roles, ['剧情', '剧情', '剧本', '剧本', '角色', '角色', '角色', '镜头', '分镜', '镜头'])
  const p = await f.projects.getProject(f.projectId)
  assert.equal(p.characters.visitor.description, 'A visitor')
  assert.ok(p.characters.visitor.generation.prompt)
  assert.equal(p.episodes.ep.script, draft.script)
  assert.equal(p.episodes.ep.shotIds.length, 1)
  assert.equal(p.developmentProposals[p.episodes.ep.draftProposalId].kind, 'episode_draft')
  const storyboardTask = Object.values(p.productionTasks).find((task) => task.input.label === 'episode-storyboard:ep')
  assert.equal(storyboardTask.agentRole, 'shot')
  assert.equal(storyboardTask.input.pipelineId, 'novel-to-drama-text')
  assert.equal(storyboardTask.input.pipelineVersion, 6)
  assert.equal(storyboardTask.input.pipelineNodeId, 'shot-plan')
  assert.equal(result.episodeScripts[0].script, draft.script)
  await assert.rejects(f.submit('episode_script', { ...result.episodeScripts[0], script: 'Changed by storyboard' }), /cannot change/)
  await assert.rejects(f.submit('asset_design', { ...visual, analysisProposalId: 'stale' }), /stale/)
  await assert.rejects(f.submit('asset_design', { ...visual, analysisProposalId: p.storyBible.proposalId, characters: [{ ...visual.characters[0], name: 'Different person' }] }), /only change visualDescription/)
  await assert.rejects(f.submit('episode_draft', { ...draft, shots: board.shots }), /cannot submit shots/)
})

test('rendering preserves authored prompts while deterministic delivery bypasses the model', async () => {
  const project = authorFixture({ id: 'p', productionSpec: {}, storyBible: { proposalId: 'analysis' }, characters: { visitor: structuredClone(analysis.characters[0]) }, locations: {}, shots: { s: { ...board.shots[0], episodeId: 'ep', scriptVersion: 1, storyboardAssetId: 'preview' } }, episodes: { ep: { id: 'ep', script: draft.script } } })
  const seen = new Set()
  let calls = 0
  const runWorkflow = async (tasks) => {
    const workflow = fakeWorkflow((_prompt, options) => {
      calls++
      seen.add(options.label.split(':')[0])
      const task = tasks.find((task) => options.label.endsWith(`:${task.label}`))
      const signature = task.prompt.match(/inputSignature=([a-f0-9]+)/)[1]
      const input = JSON.parse(task.prompt.split('\n输入：')[1])
      return { taskId: task.label, inputSignature: signature, decision: 'ready', reason: '', ...(task.role === 'delivery' ? { nodes: input.nodes, strategy: input.strategy } : { prompt: 'A faithful production prompt' }) }
    })
    return (await runProductionWorkflow(workflow, tasks, {})).result
  }
  const tasks = [
    { id: 'ref', kind: 'render-reference', scopeId: 'visitor', input: { preparationKind: 'character' } },
    { id: 'preview', kind: 'render-storyboard', scopeId: 's', input: {} },
    { id: 'video', kind: 'render-shot', scopeId: 's', input: { prompt: 'Original', duration: 5 } },
    { id: 'deliver', kind: 'deliver-drama', scopeId: 'p', input: { nodes: ['s'], strategy: 'preserve' } },
  ]
  for (const task of tasks) {
    task.checkpoint = {}
    const checkpoint = async (_name, value) => Object.assign(task.checkpoint, value)
    const prepared = await prepareMediaTask({ project, task, checkpoint, runWorkflow })
    assert.equal(prepared.input.duration, task.input.duration)
    const before = calls
    await prepareMediaTask({ project, task, checkpoint, runWorkflow })
    assert.equal(calls, before, 'a retry must reuse the validated plan')
  }
  assert.deepEqual([...seen], [], 'rendering must not silently reauthor saved prompts and delivery must stay deterministic')
  project.shots.s.duration = 8
  await assert.rejects(prepareMediaTask({ project, task: tasks[2], checkpoint: async () => {}, runWorkflow }), /需更新/)
})

test('delivery preparation does not delegate deterministic assembly data to a model', async () => {
  const project = { id: 'p', episodes: {}, shots: {}, assets: {}, legacyCanvas: { nodes: [{ id: 'episode-film', status: 'ready', media: 'episode.mp4', params: { contentHash: 'film-hash', actualDuration: 12, sources: ['s1', 's2'] } }] } }
  const task = { id: 'delivery', kind: 'deliver-drama', input: { nodes: ['episode-film'], strategy: 'preserve' }, checkpoint: {} }
  let called = false
  const prepared = await prepareMediaTask({ project, task, checkpoint: async () => {}, runWorkflow: async () => { called = true } })
  assert.equal(prepared, task)
  assert.equal(called, false)
})

test('coordinator repairs only invalid child results once and preserves successful siblings', async () => {
  const calls = []
  const workflow = fakeWorkflow((prompt, options) => {
    const id = options.label.split(':')[1]
    calls.push(id)
    return { valid: id === 'good' || prompt.includes('must be valid') }
  })
  const tasks = ['good', 'bad'].map((label) => ({ label, role: 'shot', phase: '镜头', schema: {}, prompt: 'Task', validate: (value) => { if (!value.valid) throw new Error('must be valid') } }))
  const result = await runProductionWorkflow(workflow, tasks, {})
  assert.deepEqual(calls, ['good', 'bad', 'bad'])
  assert.ok(result.result.every((item) => item.value.valid))
  const failed = await runProductionWorkflow(fakeWorkflow(() => null), [tasks[0]], {})
  assert.equal(failed.agentsStarted, 2)
  assert.ok(failed.result[0].error)
})

test('all six named roles are dispatched with scoped instructions; unknown roles never start', async () => {
  const calls = []
  const workflow = fakeWorkflow((prompt, options) => { calls.push({ prompt, options }); return { ok: true } })
  await runProductionWorkflow(workflow, Object.keys(PRODUCTION_ROLES).map((role) => ({ role, label: role, phase: role, schema: {}, prompt: 'Only this task' })), {})
  assert.equal(calls.length, 6)
  assert.ok(calls.every((call) => call.prompt.includes('禁止调用工作区工具') && call.prompt.includes('创建子代理')))
  await assert.rejects(runProductionWorkflow(workflow, [{ role: 'unknown' }], {}), /unknown production/)
  assert.equal(calls.length, 6)
})
