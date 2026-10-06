import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { NOVEL_SCHEMAS, novelTextProduction, assertNovelCoverage } from '../../lib/script/novel-production.js'
import { regenerateText } from '../../lib/script/rework.js'
import { PRODUCTION_WORKFLOW, runProductionWorkflow } from '../../lib/agents/workflow.js'

const span = { sourceId: 'source', start: 0, end: 100 }
const beat = { id: 'letter', description: 'Find a letter', sourceSpans: [span] }
const characters = [{ id: 'detective', name: 'Detective', description: 'Blue coat' }]
const locations = [{ id: 'station', name: 'Station', description: 'Old station' }]
const summary = { facts: ['Find a letter'], beats: [beat], characters, locations, citations: [span], openConflicts: [] }
const analysis = { summary: 'A detective finds a letter.', storyBible: { premise: 'Find a letter' }, beats: [beat], characters, locations, citations: [span] }
const episode = { id: 'ep', order: 1, title: 'Letter', outline: 'Find a letter.', beatIds: ['letter'], sourceSpans: [span] }
const script = { episodeId: 'ep', script: 'The detective enters the station and opens a letter.', sourceSpans: [span], shots: [{ id: 's', order: 1, duration: 7, title: 'Open the letter', shotDescription: 'The detective opens a letter in the station.', prompt: 'The detective opens a letter.', audioDialogue: 'Detective: A letter!', audioNotes: 'Footsteps', beatIds: ['letter'], referenceBindings: [{ kind: 'character', entityId: 'detective' }, { kind: 'location', entityId: 'station' }] }] }
const draft = { episodeId: 'ep', script: script.script, beatIds: ['letter'], sourceSpans: [span] }
const board = { episodeId: 'ep', shots: script.shots }
const assets = { characters: [{ id: 'detective', visualDescription: 'Blue coat' }], locations: [{ id: 'station', visualDescription: 'Old station' }] }

async function fixture(runWorkflow) {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await projects.createProject({ payload: { title: 'Text recovery' } })
  return { projects, projectId: created.project.id, sourceId: 'source', contentHash: 'source-hash', segments: [{ start: 0, end: 100, text: 'A detective finds a letter.'.padEnd(100, ' ') }], schemas: NOVEL_SCHEMAS, runWorkflow }
}

const valueFor = (label) => structuredClone(label.startsWith('source-summary:') ? summary : label === 'story-reconcile' ? analysis : label === 'asset-design' ? assets : label === 'episode-plan' ? { episodes: [episode] } : label.startsWith('episode-storyboard:') ? board : draft)

test('text rework targets each stage and rejects mismatched or incomplete scripts', async () => {
  const project = { id: 'p', sourceDocuments: { source: { id: 'source', characters: 100, contentHash: 'hash' } }, storyBible: { summary: analysis.summary, proposalId: 'analysis' }, developmentProposals: { analysis: { payload: analysis } }, characters: Object.fromEntries(characters.map(item => [item.id, item])), locations: Object.fromEntries(locations.map(item => [item.id, item])), episodes: { ep: episode } }
  const sourceService = { readChunk: async () => ({ start: 0, end: 100, text: 'A detective finds a letter.'.padEnd(100, ' ') }) }
  const calls = []
  let badScript = null
  const runWorkflow = async tasks => tasks.map(task => {
    calls.push(task.label)
    return { label: task.label, value: structuredClone(task.label.startsWith('summary:') ? summary : task.label === 'analysis' ? analysis : task.label === 'plan' ? { episodes: [episode] } : task.label === 'storyboard' ? badScript || board : draft) }
  })
  const options = { project, sourceService, runWorkflow, id: 'ep' }
  assert.equal((await regenerateText({ ...options, kind: 'analysis' })).kind, 'content_analysis')
  assert.deepEqual(calls.splice(0), ['summary:0', 'analysis'])
  assert.equal((await regenerateText({ ...options, kind: 'outline' })).kind, 'episode_plan')
  assert.deepEqual(calls.splice(0), ['plan'])
  assert.equal((await regenerateText({ ...options, kind: 'script' })).kind, 'episode_script')
  assert.deepEqual(calls.splice(0), ['script', 'storyboard'])
  badScript = { ...board, episodeId: 'wrong' }
  await assert.rejects(regenerateText({ ...options, kind: 'script' }), /分镜 subagent/)
  badScript = { ...board, shots: [{ ...script.shots[0], beatIds: [] }] }
  await assert.rejects(regenerateText({ ...options, kind: 'script' }), /分镜未覆盖/)
})

test('a failed child is persisted; recovery reruns only the missing task', async () => {
  const calls = []
  let fail = true
  const options = await fixture(async (tasks) => tasks.map((task) => {
    calls.push(task.label)
    return { label: task.label, value: fail && task.label.startsWith('episode-script:') ? null : valueFor(task.label) }
  }))
  const materialized = []
  options.onProposal = async (kind) => { materialized.push(kind) }
  await assert.rejects(novelTextProduction(options), /文本制作失败/)
  assert.deepEqual(materialized, ['content_analysis', 'asset_design', 'episode_plan'], 'completed upstream stages remain visible when script writing fails')
  let p = await options.projects.getProject(options.projectId)
  const failed = Object.values(p.productionTasks).find((task) => task.input.label === 'episode-script:ep')
  assert.equal(failed.status, 'failed')
  assert.equal(Object.values(p.productionRuns).find((run) => run.id === failed.runId).status, 'failed')
  assert.equal(Object.values(p.productionTasks).filter((task) => task.status === 'completed').length, 4)
  fail = false
  const result = await novelTextProduction(options)
  assertNovelCoverage(result, 'source', 100)
  assert.deepEqual(calls, ['source-summary:0', 'story-reconcile', 'asset-design', 'episode-plan', 'episode-script:ep', 'episode-script:ep', 'episode-storyboard:ep'])
  p = await options.projects.getProject(options.projectId)
  assert.ok(Object.values(p.productionRuns).every((run) => run.status === 'completed'))
  assert.equal(Object.keys(p.shots).length, 0, 'text checkpoints must not fabricate shots or start media')
})

test('semantic omissions fail the affected text task before it is recorded as completed', async () => {
  const options = await fixture(async (tasks) => tasks.map((task) => {
    const value = valueFor(task.label)
    if (task.label.startsWith('episode-storyboard:')) value.shots[0].beatIds = []
    return { label: task.label, value }
  }))
  await assert.rejects(novelTextProduction(options), /文本制作失败/)
  const p = await options.projects.getProject(options.projectId)
  const task = Object.values(p.productionTasks).find((task) => task.input.label === 'episode-storyboard:ep')
  assert.equal(task.status, 'failed')
  assert.match(task.error, /分镜未覆盖/)
})

test('storyboard recovery reuses the approved script instead of invoking its agent again', async () => {
  const project = { id: 'p', sourceDocuments: { source: { id: 'source', characters: 100, contentHash: 'hash' } }, storyBible: { summary: analysis.summary, proposalId: 'analysis' }, developmentProposals: { analysis: { payload: analysis } }, characters: Object.fromEntries(characters.map(item => [item.id, item])), locations: Object.fromEntries(locations.map(item => [item.id, item])), episodes: { ep: episode } }
  const sourceService = { readChunk: async () => ({ start: 0, end: 100, text: 'Original'.padEnd(100, ' ') }) }
  const calls = []
  let saved = {}
  let fail = true
  const options = { project, sourceService, kind: 'script', id: 'ep', checkpoint: async (_name, value) => { saved = structuredClone(value.textResults) }, runWorkflow: async (tasks) => tasks.map((task) => {
    calls.push(task.role)
    return { label: task.label, value: task.role === 'script' ? draft : fail ? null : board }
  }) }
  await assert.rejects(regenerateText(options), /没有返回/)
  assert.deepEqual(Object.keys(saved), ['script'])
  fail = false
  const result = await regenerateText({ ...options, completed: saved })
  assert.equal(result.payload.script, draft.script)
  assert.deepEqual(calls, ['script', 'storyboard', 'storyboard'])
})

test('fixed workflow returns a failed child envelope instead of dropping it', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const run = new AsyncFunction('agent', 'parallel', 'phase', 'args', PRODUCTION_WORKFLOW)
  const parallel = (thunks) => Promise.all(thunks.map(async (thunk) => { try { return await thunk() } catch { return null } }))
  const tasks = [{ label: 'ok', role: 'script', schema: {}, phase: '分集剧本' }, { label: 'failed', role: 'script', schema: {}, phase: '分集剧本' }]
  const result = await runProductionWorkflow({ execute: async (args) => ({ kind: 'foreground', result: await run(async (_prompt, options) => options.label === '剧本:ok' ? { script: 'valid' } : null, parallel, () => {}, args.args) }) }, tasks, {})
  const output = result.result
  assert.equal(output.length, 2)
  assert.equal(output[1].label, 'failed')
  assert.equal(output[1].value, null)
})

test('coverage rejects outline substitution, omitted source, unknown references and missing episodes', () => {
  const value = { analysis: structuredClone(analysis), episodePlan: { episodes: [structuredClone(episode)] }, episodeScripts: [structuredClone(script)] }
  assert.doesNotThrow(() => assertNovelCoverage(value, 'source', 100))
  for (const change of [
    (v) => { v.episodeScripts = [] },
    (v) => { v.episodeScripts[0].script = v.episodePlan.episodes[0].outline },
    (v) => { v.episodePlan.episodes[0].sourceSpans[0].start = 10 },
    (v) => { v.episodeScripts[0].shots[0].referenceBindings[0].entityId = 'unknown' },
    (v) => { v.episodeScripts[0].shots[0].duration = 30 },
  ]) {
    const broken = structuredClone(value)
    change(broken)
    assert.throws(() => assertNovelCoverage(broken, 'source', 100))
  }
})

test('empty establishing shots explicitly omit characters, and workflow schemas stay in the supported subset', () => {
  const value = { analysis: structuredClone(analysis), episodePlan: { episodes: [structuredClone(episode)] }, episodeScripts: [structuredClone(script)] }
  const shot = value.episodeScripts[0].shots[0]
  shot.characterIds = []
  shot.referenceBindings = [{ kind: 'location', entityId: 'station' }]
  assert.doesNotThrow(() => assertNovelCoverage(value, 'source', 100))
  shot.characterIds = ['detective']
  assert.throws(() => assertNovelCoverage(value, 'source', 100), /characterIds/)
  const allowed = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title'])
  const check = (schema) => {
    for (const key of Object.keys(schema)) assert.ok(allowed.has(key), `unsupported workflow schema keyword: ${key}`)
    for (const child of Object.values(schema.properties || {})) check(child)
    if (schema.items) check(schema.items)
    for (const child of schema.oneOf || []) check(child)
  }
  for (const schema of Object.values(NOVEL_SCHEMAS)) check(schema)
})
