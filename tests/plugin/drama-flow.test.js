import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { extractedAssets, promptResponse, generation } from '../helpers/generation.js'

test('novel entrypoint produces every stage, resumes failed downloads and reuses delivered output', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'drama-flow-'))
  const home = mock.method(os, 'homedir', () => root)
  syncBuiltinESMExports()
  const originalFetch = globalThis.fetch
  const { MemoryProjectRepository, ProjectService } = await import('../../lib/domain/service.js')
  const repository = new MemoryProjectRepository()
  const tools = new Map()
  const disposers = []
  const graphs = []
  const outputs = new Map()
  const textCalls = []
  const mediaCalls = []
  const assignedRoles = new Set()
  let coordinators = 0
  let disposedCoordinators = 0
  let failDownloads = true
  let failEpisodePlan = false
  let concludedTurns = 0
  let videoId
  const source = '小林穿蓝色外套走进车站。她拿起长椅上的信封。'
  const span = { sourceId: 'source-001', start: 0, end: source.length }
  const characters = [{ id: 'lin', name: '小林', description: '蓝色外套，黑色短发' }]
  const locations = [{ id: 'station', name: '车站', description: '白墙、木长椅' }]
  const beats = [{ id: 'enter', description: '走进车站', sourceSpans: [span] }, { id: 'letter', description: '拿起信封', sourceSpans: [span] }]
  const episodes = beats.map((beat, i) => ({ id: `ep${i + 1}`, order: i + 1, title: beat.description, outline: `${beat.description}的大纲`, beatIds: [beat.id], sourceSpans: [span] }))
  const textValue = (label, task) => {
    if (label.startsWith('asset-prompt:')) return generation()
    if (label.includes('-prompts:')) return promptResponse(task)
    if (label.startsWith('asset-extraction:')) {
      const episode = episodes.find((item) => label.endsWith(`:${item.id}`))
      return extractedAssets(characters, locations, episode.id, `小林在车站${episode.title}。`)
    }
    if (label.startsWith('source-summary:')) return { facts: [source], characters, locations, beats, citations: [span], openConflicts: [] }
    if (label === 'story-reconcile') return { summary: source, storyBible: { visualStyle: '写实' }, characters, locations, beats, citations: [span] }
    if (label === 'asset-design') return { characters: characters.map(({ id, description }) => ({ id, visualDescription: description })), locations: locations.map(({ id, description }) => ({ id, visualDescription: description })) }
    if (label === 'episode-plan') return { episodes }
    const episode = episodes.find((item) => label.endsWith(`:${item.id}`))
    if (label.startsWith('episode-script:')) return { episodeId: episode.id, script: `小林在车站${episode.title}。`, beatIds: episode.beatIds, sourceSpans: [span] }
    return { episodeId: episode.id, shots: [{ id: 's1', order: 1, duration: 2, title: episode.title, shotDescription: `小林${episode.title}。`, prompt: `A woman in a blue coat at a train station. ${episode.title}`, audioDialogue: '', audioNotes: '车站环境声', beatIds: episode.beatIds, referenceBindings: [{ kind: 'character', entityId: 'lin' }, { kind: 'location', entityId: 'station' }] }] }
  }
  const png = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'])
  globalThis.fetch = async (input, init) => {
    const url = new URL(input)
    if (url.pathname.includes('/object_info/')) return Response.json({ registered: {} })
    if (url.pathname.endsWith('/upload/image')) return Response.json({ name: init.body.get('image').name, subfolder: '', type: 'input' })
    if (url.pathname.endsWith('/prompt')) {
      const graph = JSON.parse(init.body).prompt
      graphs.push(graph)
      const id = `prompt-${graphs.length}`
      const nodes = Object.values(graph)
      const video = nodes.find((node) => node.class_type === 'MiniMaxH3ReferenceToVideo')
      if (video) {
        assert.equal(nodes.filter((node) => node.class_type === 'LoadImage').length, 3, 'video must receive character, location and storyboard images')
        assert.ok(video.inputs.length >= 48 && video.inputs.length < 60, 'duration must reach the actual graph')
        const file = join(root, `${id}.mp4`)
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(video.inputs.length / 24), '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', file])
        const buffer = await readFile(file)
        outputs.set(id, { buffer, filename: `${id}.mp4` })
        videoId ||= id
      } else outputs.set(id, { buffer: png, filename: `${id}.png` })
      return Response.json({ prompt_id: id })
    }
    if (url.pathname.includes('/history/')) {
      const id = url.pathname.split('/').at(-1)
      return Response.json({ [id]: { status: { completed: true }, outputs: { output: { images: [{ filename: outputs.get(id).filename, type: 'output' }] } } } })
    }
    if (url.pathname.endsWith('/view')) {
      const filename = url.searchParams.get('filename')
      if (failDownloads && filename === `${videoId}.mp4`) return new Response('', { status: 503 })
      const output = [...outputs.values()].find((item) => item.filename === filename)
      assert.ok(output, `unknown download ${filename}`)
      return new Response(output.buffer)
    }
    throw new Error(`unexpected external request: ${url.pathname}`)
  }
  try {
    const { apply } = await import('../../lib/index.js')
    const sessionId = 'flow-session'
    const workflow = { async execute(args) {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      const run = new AsyncFunction('agent', 'parallel', 'phase', 'args', args.script)
      const result = await run(async (_prompt, options) => {
        const task = args.args.tasks.find((item) => item.agentLabel === options.label)
        assignedRoles.add(task.role)
        if (!task.schema.properties.inputSignature) {
          textCalls.push(task.label)
          if (failEpisodePlan && task.label === 'episode-plan') return null
          return structuredClone(textValue(task.label, task))
        }
        mediaCalls.push(task.label)
        const input = JSON.parse(task.prompt.split('\n输入：')[1])
        return { taskId: task.label, inputSignature: task.prompt.match(/inputSignature=([a-f0-9]+)/)[1], decision: 'ready', reason: '', ...(task.role === 'delivery' ? { nodes: input.nodes, strategy: input.strategy } : { prompt: input.entity.prompt || input.entity.visualDescription || input.entity.description }) }
      }, (thunks) => Promise.all(thunks.map((fn) => fn())), () => {}, args.args)
      return { kind: 'foreground', runId: 'text-workflow', agentsStarted: args.args.tasks.length, result }
    } }
    const host = {
      effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} },
      on() { return () => {} },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
      agents: { async create(options) {
        assert.equal(options.meta.parentSession, sessionId)
        coordinators++
        return { agent: { id: options.sessionId, session: { id: options.sessionId, header: options.meta } }, async dispose() { disposedCoordinators++ } }
      } },
      tools: { register(tool) { tools.set(tool.name, tool); return () => {} }, get(name) { return name === 'workflow' ? workflow : tools.get(name) } },
      storage: { domain: { async open() { return { close: async () => {}, table(name) {
        if (name === 'projects') return { get: (id) => repository.get(id), entries: () => repository.projects.entries(), put: (_id, p) => repository.put(p), update: (id, fn) => repository.update(id, fn) }
        return { get: (id) => repository.getBinding(id), put: (_id, binding) => repository.putBinding(binding) }
      } } } } },
      workspaceRegistry: { get() { return null }, list() { return [{ id: 'workspace', path: root, sessionIds: [sessionId] }] } },
      systemPrompt: { section() { return () => {} } },
      webServer: { register() { return () => {} } },
    }
    apply(host)
    const exec = { agent: { id: sessionId, session: { id: sessionId, header: { cwd: root } } }, concludeTurn() { concludedTurns++ } }
    const call = async (name, args) => {
      const value = await tools.get(name).execute(args, exec)
      assert.equal(value.ok, true, `${name}: ${value.error}`)
      return JSON.parse(value.json)
    }
    const wait = async (projectId, runId) => {
      for (let i = 0; i < 220; i++) {
        const p = await call('studio_project_get', { projectId })
        const run = p.productionRuns[runId]
        if (run.status !== 'active') return p
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error('production failed to settle')
    }
    await writeFile(join(root, 'failing.txt'), '\uFEFF' + source.replace('信封', '纸条'))
    failEpisodePlan = true
    const failedCreate = await tools.get('studio_novel_create').execute({ sourcePath: 'failing.txt', title: '失败恢复验收' }, exec)
    failEpisodePlan = false
    assert.equal(failedCreate.ok, false)
    assert.equal(concludedTurns, 1, 'failed novel creation must terminate the agent turn')
    assert.deepEqual(JSON.parse(failedCreate.json), {
      projectId: JSON.parse(failedCreate.json).projectId,
      bindingKey: JSON.parse(failedCreate.json).bindingKey,
      status: 'failed',
      recoverable: true,
    })
    assert.ok(JSON.parse(failedCreate.json).projectId)
    textCalls.length = 0
    await writeFile(join(root, 'source.txt'), '\uFEFF' + source)
    const [created, concurrent] = await Promise.all([0, 1].map(() => call('studio_novel_create', { sourcePath: 'source.txt', title: '流程验收：车站的信封' })))
    assert.equal(concurrent.projectId, created.projectId)
    assert.equal(concurrent.runId, created.runId)
    let p = await wait(created.projectId, created.runId)
    assert.equal(p.productionRuns[created.runId].status, 'failed')
    const failed = Object.values(p.productionTasks).filter((task) => task.status === 'failed')
    assert.equal(failed.length, 1, JSON.stringify(failed.map((task) => [task.kind, task.error])))
    assert.match(failed[0].error, /comfy-download-failed/)
    assert.equal(Object.keys(p.deliverables).length, 0)
    const before = graphs.length
    await call('studio_novel_create', { sourcePath: 'source.txt', title: '流程验收：车站的信封' })
    p = await wait(created.projectId, created.runId)
    assert.equal(p.productionRuns[created.runId].status, 'failed')
    assert.equal(graphs.length, before, 'a second download failure must preserve the same remote job')
    for (const dispose of disposers.splice(0).reverse()) await dispose()
    apply(host)
    failDownloads = false
    const resumed = await call('studio_novel_create', { sourcePath: 'source.txt', title: '流程验收：车站的信封' })
    assert.equal(resumed.runId, created.runId)
    p = await wait(created.projectId, created.runId)
    assert.equal(p.productionRuns[created.runId].status, 'completed', JSON.stringify(Object.values(p.productionTasks).filter((task) => task.error).map((task) => [task.kind, task.error])))
    assert.equal(graphs.length, before, 'download recovery must not resubmit completed GPU work')
    assert.equal(p.status, 'completed')
    assert.equal(Object.values(p.assets).filter((asset) => asset.kind === 'image').length, 4)
    const { canvasReadModel } = await import('../../lib/domain/read-models.js')
    const canvas = canvasReadModel(p)
    assert.equal(canvas.production.status, 'completed')
    for (const stage of ['analysis', 'assets', 'scripts', 'storyboard']) assert.ok(canvas.nodes.some((node) => node.stage === stage), stage)
    const deliverable = Object.values(p.deliverables)[0]
    assert.match(deliverable.logicalKey, /step-10-delivery/)
    const storageRoot = join(root, '.dsh', 'storages', 'short_video_studio')
    assert.ok((await readFile(join(storageRoot, deliverable.logicalKey))).length > 0)
    assert.equal(deliverable.qualityReport.visualReview, 'not_performed')
    const reused = await call('studio_novel_create', { sourcePath: 'source.txt', title: '流程验收：车站的信封' })
    assert.equal(reused.runId, created.runId)
    assert.equal(graphs.length, before)
    assert.equal(textCalls.length, 15)
    assert.deepEqual([...assignedRoles].sort(), ['assets', 'delivery', 'script', 'shot', 'story', 'storyboard'])
    assert.equal(new Set(mediaCalls).size, mediaCalls.length, 'download retries and host restart must reuse subagent plans')
    assert.equal(disposedCoordinators, coordinators, 'background coordination contexts must be disposed')
    await rm(join(storageRoot, deliverable.logicalKey))
    const missing = await tools.get('studio_novel_create').execute({ sourcePath: 'source.txt', title: '流程验收：车站的信封' }, exec)
    assert.equal(missing.ok, false, 'missing delivery file cannot be reported as successful reuse')
    const projects = await new ProjectService(repository).open()
    const current = await projects.getProject(created.projectId)
    const rework = await projects.execute({ projectId: current.id, expectedRevision: current.revision, commandId: 'verify-video-rework', type: 'requestProductionRework', payload: { kind: 'media', input: { sessionId, workspaceId: 'workspace' } } })
    const reworkRun = rework.output.runId
    p = await wait(created.projectId, reworkRun)
    assert.equal(p.productionRuns[reworkRun].status, 'completed', JSON.stringify(p.productionRuns[reworkRun].taskIds.map(id => p.productionTasks[id].error)))
    assert.equal(graphs.length, before + 2, 'video rework must not regenerate reference or storyboard images')
    for (const episode of Object.values(p.episodes).filter(episode => episode.id !== 'legacy-main')) for (const id of episode.shotIds) {
      const asset = p.assets[p.shots[id].approvedAssetId]
      const snapshot = asset.sourceIds.map(sourceId => p.attempts[sourceId]?.inputSnapshot).find(Boolean)
      assert.equal(snapshot.target.kind, 'shot')
      assert.equal(snapshot.target.id, id)
    }
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    globalThis.fetch = originalFetch
    home.mock.restore()
    syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true })
  }
})
