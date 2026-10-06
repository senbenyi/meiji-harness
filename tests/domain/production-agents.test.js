import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { makeScriptDevelopmentTools } from '../../lib/script/tools.js'
import { NOVEL_SCHEMAS, novelTextProduction } from '../../lib/script/novel-production.js'
import { PRODUCTION_ROLES } from '../../lib/agents/roles.js'
import { PRODUCTION_WORKFLOW, runProductionWorkflow } from '../../lib/agents/workflow.js'
import { prepareMediaTask } from '../../lib/agents/media.js'
import { canvasReadModel } from '../../lib/domain/read-models.js'

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
  const workflow = fakeWorkflow((_prompt, options) => {
    const role = options.label.split(':')[0]
    roles.push(role)
    const label = options.label.slice(role.length + 1)
    return structuredClone(label.startsWith('source-summary:') ? { ...analysis, facts: [], openConflicts: [] } : label === 'story-reconcile' ? analysis : label === 'asset-design' ? visual : label === 'episode-plan' ? { episodes: [episode] } : label.startsWith('episode-storyboard:') ? board : draft)
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
  assert.deepEqual(roles, ['剧情', '剧情', '角色', '剧本', '剧本', '分镜'])
  const p = await f.projects.getProject(f.projectId)
  assert.equal(p.characters.visitor.description, 'A visitor')
  assert.equal(p.characters.visitor.visualDescription, 'A blue coat')
  assert.equal(p.episodes.ep.script, draft.script)
  assert.equal(p.episodes.ep.shotIds.length, 1)
  assert.equal(p.developmentProposals[p.episodes.ep.draftProposalId].kind, 'episode_draft')
  assert.equal(Object.values(p.productionTasks).find((task) => task.input.label === 'episode-storyboard:ep').agentRole, 'storyboard')
  assert.equal(result.episodeScripts[0].script, draft.script)
  await assert.rejects(f.submit('episode_script', { ...result.episodeScripts[0], script: 'Changed by storyboard' }), /cannot change/)
  await assert.rejects(f.submit('asset_design', { ...visual, analysisProposalId: 'stale' }), /stale/)
  await assert.rejects(f.submit('asset_design', { ...visual, analysisProposalId: p.storyBible.proposalId, characters: [{ ...visual.characters[0], name: 'Different person' }] }), /only change visualDescription/)
  await assert.rejects(f.submit('episode_draft', { ...draft, shots: board.shots }), /cannot submit shots/)
})

test('media roles use real workflow dispatch, persist plans and reject cross-scope or stale results', async () => {
  const project = { id: 'p', productionSpec: {}, storyBible: { proposalId: 'analysis' }, characters: { visitor: analysis.characters[0] }, locations: {}, shots: { s: { ...board.shots[0], scriptVersion: 1, storyboardAssetId: 'preview' } }, episodes: {} }
  const seen = new Set()
  let calls = 0
  let rewrite = (value) => value
  const runWorkflow = async (tasks) => {
    const workflow = fakeWorkflow((_prompt, options) => {
      calls++
      seen.add(options.label.split(':')[0])
      const task = tasks.find((task) => options.label.endsWith(`:${task.label}`))
      const signature = task.prompt.match(/inputSignature=([a-f0-9]+)/)[1]
      const input = JSON.parse(task.prompt.split('\n输入：')[1])
      return rewrite({ taskId: task.label, inputSignature: signature, decision: 'ready', reason: '', ...(task.role === 'delivery' ? { nodes: input.nodes, strategy: input.strategy } : { prompt: 'A faithful production prompt' }) })
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
  assert.deepEqual([...seen], ['角色', '分镜', '镜头', '成片'])
  project.shots.s.storyboardAssetId = 'preview-new'
  await prepareMediaTask({ project, task: tasks[1], checkpoint: async () => {}, runWorkflow })
  await assert.rejects(prepareMediaTask({ project, task: tasks[2], checkpoint: async () => {}, runWorkflow }), /过期/)
  rewrite = (value) => ({ ...value, nodes: [] })
  await assert.rejects(prepareMediaTask({ project, task: { ...tasks[3], checkpoint: {} }, checkpoint: async () => {}, runWorkflow }), /遗漏/)
  rewrite = (value) => ({ ...value, taskId: 'another-task' })
  await assert.rejects(prepareMediaTask({ project, task: { ...tasks[2], checkpoint: {} }, checkpoint: async () => {}, runWorkflow }), /错误的任务/)
  rewrite = (value) => ({ ...value, decision: 'rework', reason: 'Dialogue cannot fit' })
  await assert.rejects(prepareMediaTask({ project, task: { ...tasks[2], checkpoint: {} }, checkpoint: async () => {}, runWorkflow }), /请求返工.*Dialogue/)
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
