import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('registered batch and render entrypoints reject incomplete drama before any remote request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-stage-entrypoints-'))
  const previousHome = process.env.HOME
  const originalFetch = globalThis.fetch
  let remoteCalls = 0
  const disposers = []
  process.env.HOME = root
  globalThis.fetch = async () => { remoteCalls++; throw new Error('remote generation forbidden in this test') }
  try {
    const { apply } = await import('../../lib/index.js')
    const tools = new Map()
    const sessionId = 'stage-test-session'
    const host = {
      __testMemoryProjectDomain: true,
      effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} },
      on() { return () => {} },
      tools: { register(tool) { tools.set(tool.name, tool); return () => {} }, get(name) { return tools.get(name) } },
      workspaceRegistry: { get() { return null }, list() { return [{ id: 'workspace', path: root, sessionIds: [sessionId] }] } },
      systemPrompt: { section() { return () => {} } },
      webServer: { register() { return () => {} } },
    }
    apply(host)
    const exec = { agent: { id: sessionId, session: { id: sessionId, meta: { cwd: root }, header: {} } } }
    const call = async (name, args) => {
      const response = await tools.get(name).execute(args, exec)
      assert.equal(response.ok, true, `${name}: ${response.error}`)
      return JSON.parse(response.json)
    }
    const created = await call('studio_project_create', { title: 'Incomplete drama' })
    await writeFile(join(root, 'novel.txt'), 'A detective finds a letter in the old station.')
    await call('studio_source_import', { projectId: created.projectId, sourcePath: 'novel.txt', title: 'Novel', format: 'txt' })
    let project = await call('studio_project_get', { projectId: created.projectId })
    const ep = await call('studio_episode_upsert', { projectId: project.id, revision: project.revision, episode: { id: 'ep', title: 'Episode' } })
    project = await call('studio_project_get', { projectId: created.projectId })
    await call('studio_shot_upsert', { projectId: project.id, revision: project.revision, shot: { episodeId: ep.id, id: 's', title: 'Shot', prompt: 'A detective.', status: 'planned' } })
    project = await call('studio_project_get', { projectId: created.projectId })
    const shotId = Object.keys(project.shots)[0]
    const batch = await tools.get('studio_batch_generate').execute({ projectId: project.id, shotIds: [shotId], capability: 'video.reference2video', tier: 'fast' }, exec)
    assert.equal(batch.ok, false)
    assert.match(batch.error, /production stages blocked/)
    const rendered = await tools.get('comfy_render').execute({ capability: 'video.reference2video', prompt: 'A detective.', nodeId: shotId }, exec)
    assert.match(rendered.error, /production stages blocked/)
    project = await call('studio_project_get', { projectId: created.projectId })
    assert.equal(Object.keys(project.attempts).length, 0)
    assert.equal(Object.keys(project.productionRuns).length, 0)
    assert.equal(remoteCalls, 0)
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    globalThis.fetch = originalFetch
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})
