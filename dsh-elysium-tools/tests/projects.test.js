import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createProject, projectDirectory, readProject, renameProject, listProjects, deleteProject,
  sessionProject, bindProjectJob, assertProjectJob, adoptVideo, createSaveBriefTool, projectContext } from '../src/projects/store.js'
import { createProjectsHandler, registerProjectRoutes, PROJECT_ROUTE } from '../src/projects/http.js'

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'drama-test-'))), previous = process.env.ARTIFACTS_ROOT
  process.env.ARTIFACTS_ROOT = root
  try { await run(root) } finally {
    if (previous === undefined) delete process.env.ARTIFACTS_ROOT; else process.env.ARTIFACTS_ROOT = previous
    await rm(root, { recursive: true, force: true })
  }
}
const execFor = p => ({ callId: 'call', agent: { session: { id: p.sessionId, header: { cwd: projectDirectory(p.id), agentPreset: 'elysium' } } } })
test('project identity survives rename and restart; foreign sessions cannot adopt its directory', () => fixture(async () => {
  const p = await createProject('武侠爱情'), path = projectDirectory(p.id)
  await renameProject(p.id, '江湖相逢')
  assert.equal((await readProject(p.id)).sessionId, p.sessionId)
  assert.equal(projectDirectory(p.id), path)
  assert.equal((await listProjects())[0].name, '江湖相逢')
  assert.equal((await sessionProject(execFor(p).agent.session)).id, p.id)
  await assert.rejects(sessionProject({ id: 'foreign', header: execFor(p).agent.session.header }), /不属于/)
  await assert.rejects(readProject('../escape'), /不存在/)
  await assert.rejects(createProject(' '), /名称/)
  await deleteProject(p.id)
  assert.deepEqual(await listProjects(), [])
  await assert.rejects(sessionProject(execFor(p).agent.session), /不存在/)
  assert.ok(await readFile(join(path, 'project.json')))
}))
test('project brief and jobs persist; concurrent binding and adoption do not lose updates or cross projects', () => fixture(async root => {
  const p = await createProject('短剧一'), other = await createProject('短剧二'), exec = execFor(p)
  await createSaveBriefTool().execute({ text: '两位剑客雨中重逢' }, exec)
  const assembly = await projectContext({ tools: [{ name: 'drama_save_brief' }], sections: [] }, exec.agent)
  assert.match(assembly.sections[0].text, /两位剑客/)
  assert.deepEqual((await projectContext({ tools: [{ name: 'drama_save_brief' }], sections: [] }, {})).tools, [])
  const ids = ['a'.repeat(32), 'b'.repeat(32)]
  await Promise.all(ids.map(jobId => bindProjectJob(jobId, exec, { duration: 10 })))
  await assertProjectJob(ids[0], exec)
  await assert.rejects(assertProjectJob(ids[0], execFor(other)), /当前短剧/)
  await assert.rejects(adoptVideo(other.id, ids[0], () => {}), /不属于/)
  await writeFile(join(root, 'final.mp4'), 'movie')
  const read = async () => ({ status: 'succeeded', result: { path: join(root, 'final.mp4') } })
  await Promise.all(ids.map(id => adoptVideo(p.id, id, read)))
  await adoptVideo(p.id, ids[0], read)
  const saved = await readProject(p.id)
  assert.equal(saved.exports.length, 2)
  assert.equal(await readFile(join(projectDirectory(p.id), 'exports', saved.exports[0].filename), 'utf8'), 'movie')
  assert.equal(JSON.parse(await readFile(join(projectDirectory(p.id), 'shots.json'))).jobs.length, 2)
}))
test('HTTP creates, resumes, uploads, previews, adopts and removes with credentials and project-bound media', () => fixture(async root => {
  const opened = [], jobs = new Map()
  const server = createServer(createProjectsHandler({ token: 'secret', ensureSession: async p => opened.push(p.sessionId), readJob: async id => jobs.get(id) }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  const headers = { 'X-Elysium-Token': 'secret' }
  const post = data => fetch(base, { method: 'POST', headers, body: JSON.stringify(data) })
  try {
    assert.equal((await fetch(base)).status, 401)
    const p = await (await post({ action: 'create', name: '雨中江湖' })).json()
    for (let i = 0; i < 2; i++) assert.equal((await (await post({ action: 'open', id: p.id })).json()).sessionId, p.sessionId)
    assert.deepEqual(opened, [p.sessionId, p.sessionId])
    let response = await fetch(`${base}/asset?id=${p.id}&name=reference.png`, { method: 'PUT', headers, body: 'image' })
    assert.equal(response.status, 201)
    const asset = await response.json()
    response = await fetch(`${base}/file?id=${p.id}&asset=${asset.id}&t=secret`)
    assert.equal(await response.text(), 'image')
    assert.equal((await fetch(`${base}/asset?id=${p.id}&name=script.html`, { method: 'PUT', headers, body: 'html' })).status, 400)
    const jobId = 'c'.repeat(32)
    await bindProjectJob(jobId, execFor(p), { duration: 10 })
    jobs.set(jobId, { status: 'running' })
    assert.equal((await post({ action: 'delete', id: p.id })).status, 409)
    await writeFile(join(root, 'movie.mp4'), '0123456789')
    jobs.set(jobId, { status: 'succeeded', result: { path: join(root, 'movie.mp4') } })
    response = await fetch(`${base}/file?id=${p.id}&job=${jobId}&t=secret`, { headers: { Range: 'bytes=2-5' } })
    assert.equal(response.status, 206); assert.equal(await response.text(), '2345')
    const other = await createProject('另一部')
    assert.equal((await fetch(`${base}/file?id=${other.id}&job=${jobId}&t=secret`)).status, 403)
    assert.equal((await post({ action: 'adopt', id: p.id, jobId })).status, 200)
    assert.equal((await post({ action: 'removeAsset', id: p.id, assetId: asset.id })).status, 200)
    assert.equal((await fetch(`${base}/file?id=${p.id}&asset=${asset.id}&t=secret`)).status, 404)
    const detail = await (await fetch(`${base}?session=${p.sessionId}`, { headers })).json()
    assert.equal(detail.exports.length, 1); assert.equal(detail.jobs[0].has_video, true)
    assert.equal((await post({ action: 'delete', id: p.id })).status, 200)
    assert.equal(await (await fetch(`${base}?session=${p.sessionId}`, { headers })).json(), null)
    assert.equal((await post({ action: 'open', id: p.id })).status, 404)
  } finally { await new Promise(resolve => server.close(resolve)) }
}))
test('host adapter fixes session identity, preset and cwd', () => fixture(async () => {
  const routes = [], events = new Map(), calls = []
  registerProjectRoutes({ effect: fn => fn(), on: (name, fn) => events.set(name, fn),
    webServer: { register: row => { routes.push(row); return () => {} } }, apiProxy: { sessions: {
      create: async req => { calls.push(req.payload); return { result: { ok: true } } },
      rename: async () => ({ result: { ok: true } }),
    } } })
  assert.deepEqual(routes.map(r => r.path), [PROJECT_ROUTE, `${PROJECT_ROUTE}/asset`, `${PROJECT_ROUTE}/file`])
  const injected = []; events.get('webserver/index-inject')(injected)
  assert.equal(injected[0].name, '__ELYSIUM_PROJECTS__')
  const p = await createProject('固定会话')
  const server = createServer(routes[0].handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`, {
      method: 'POST', headers: { 'X-Elysium-Token': injected[0].value.token }, body: JSON.stringify({ action: 'open', id: p.id, sessionId: 'forged', cwd: '/tmp' }) })
    assert.equal(response.status, 200)
    assert.deepEqual(calls[0], { sessionId: p.sessionId, cwd: projectDirectory(p.id), agentPreset: 'elysium' })
  } finally { await new Promise(resolve => server.close(resolve)) }
}))
