// 职责：使用本地 HTTP 模拟模型服务和真实子进程，验收平台替换后的公共业务路径。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { apply } from './lib/index.js'
import { buildBackendGraph } from './lib/servers/runtime/index.js'
import { startVideoJob, resumeVideoJob } from './lib/business/video/service.js'
import { getJob } from './lib/business/jobs/query.js'
import { createJob } from './lib/business/jobs/create.js'
import { saveJson } from './lib/business/jobs/store.js'
import { resolveServer } from './lib/servers/registry/resolve.js'
import { backendLlmSettings, backendWorkflowSource } from './lib/servers/runtime/index.js'
import { readRegistry, writeRegistry } from './lib/servers/registry/store.js'
import { readSelection } from './lib/servers/selection/store.js'
import { backendFromServer } from './lib/servers/registry/resolve.js'
import { createComfyuiTaskCancelTool, createComfyuiTaskStatusTool } from './lib/harness/tasks.js'
import { runProduction } from './src/business/production/runner.js'
import { validateProductionManifest } from './src/business/production/manifest.js'
const provider = process.argv[2], removed = process.argv[3], services = [], jobs = [], schemas = {}
const buildVideoGraph = (plan, id) => buildBackendGraph({ provider, instance_id: 'fixture', deployment_id: 'one', service: 'comfyui', base_url: 'http://unselected.invalid', connection: { workload: 'minimax-h3' } }, plan, id)
const state = process.env.ELYSIUM_STATE_ROOT
const jobPath = (project, id) => join(state, 'projects', project, 'jobs', id)
// 这里只模拟节点协议和回执，不声称验证了真实 GPU 模型或视频质量。
function addSchema(graph) {
  for (const node of Object.values(graph)) {
    const schema = schemas[node.class_type] ||= { input: { optional: {} }, output: Array(20).fill('*') }
    for (const [key, value] of Object.entries(node.inputs)) {
      const spec = schema.input.optional[key] ||= ['*']
      if (typeof value === 'string' && /\.(safetensors|ckpt|pt|pth|gguf)$/.test(value)) {
        if (!Array.isArray(spec[0])) spec[0] = []
        if (!spec[0].includes(value)) spec[0].push(value)
      }
    }
  }
}
for (const plan of [{ profile: 'preview', mode: 't2va' }, { profile: 'regular', mode: 't2va' }, ...['t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va'].map(mode => ({ mode }))]) {
  const media = 'http://unselected.invalid/view?filename=test.png&type=input'
  addSchema((await buildVideoGraph({ ...plan, prompt: 'A quiet garden.', first_frame: media, last_frame: media, reference_image_1: media, reference_image_2: media }, 'test')).graph)
}
addSchema({ a: { class_type: 'LoadVideo', inputs: { file: '' } }, b: { class_type: 'GetVideoComponents', inputs: { video: '' } }, c: { class_type: 'ImageFromBatch', inputs: { image: '', batch_index: 0, length: 1 } }, d: { class_type: 'SaveImage', inputs: { images: '', filename_prefix: '' } } })
async function listen(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); services.push(server)
  return `http://127.0.0.1:${server.address().port}`
}
async function model() {
  const instance = { history: {}, posts: 0, pending: [[0, 'collision']], failNext: false, views: 0 }
  instance.url = await listen(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    let body = ''; for await (const chunk of req) body += chunk
    const input = body ? JSON.parse(body) : undefined
    let result
    if (path === '/system_stats') result = {}
    else if (path === '/v1/models') result = { data: [{ id: 'qwen3.8-27b-elysium' }] }
    else if (path.startsWith('/object_info/')) { const type = decodeURIComponent(path.split('/').at(-1)); result = { [type]: schemas[type] } }
    else if (path === '/prompt') {
      const id = `prompt-${++instance.posts}`
      const outputs = {}
      for (const [nodeId, node] of Object.entries(input.prompt)) {
        if (['SaveVideo', 'VHS_VideoCombine'].includes(node.class_type)) outputs[nodeId] = { videos: [{ filename: `${id}.mp4`, type: 'output' }] }
        if (node.class_type === 'SaveImage') outputs[nodeId] = { images: [{ filename: `${id}.png`, type: 'output' }] }
      }
      instance.history[id] = { status: instance.failNext ? { status_str: 'error', messages: [['execution_error', { exception_message: 'fixture failure' }]] } : { completed: true }, outputs }
      instance.failNext = false; result = { prompt_id: id }
    } else if (path === '/queue') {
      if (input?.delete) instance.pending = instance.pending.filter(row => !input.delete.includes(row[1]))
      result = { queue_running: [], queue_pending: instance.pending }
    } else if (path === '/history') result = instance.history
    else if (path.startsWith('/history/')) { const id = path.split('/').at(-1); result = instance.history[id] ? { [id]: instance.history[id] } : {} }
    else if (path === '/view') { instance.views++; res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end('fixture-media'); return }
    else { res.writeHead(404); res.end('{}'); return }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result))
  })
  return instance
}
async function completed(project, id, expected = 'succeeded') {
  jobs.push({ project, id })
  for (let i = 0; i < 150; i++) {
    const job = await getJob(id)
    const locked = await access(join(jobPath(project, id), 'worker.lock')).then(() => true, () => false)
    if (['succeeded', 'failed'].includes(job.status) && !locked) { assert.equal(job.status, expected, JSON.stringify(job)); return job }
    await pause(100)
  }
  throw new Error(`Worker timeout ${id}: ${await readFile(join(jobPath(project, id), 'worker.log'), 'utf8')}`)
}
try {
  for (const name of ['tests', 'legacy', 'resources']) await assert.rejects(access(`lib/servers/providers/${provider}/${name}`))
  const a = await model(), b = await model(), routes = new Map(), events = new Map()
  const context = { tools: { register() {} }, get: () => ({ register: route => routes.set(route.path, route.handler) }),
    inject: (_, fn) => fn(context), effect: fn => fn(), on: (event, fn) => events.set(event, fn) }
  apply(context, { enableAtomicTools: true })
  const rows = []; events.get('webserver/index-inject')(rows); const token = rows[0].value.token
  const url = await listen((req, res) => { const handler = routes.get(new URL(req.url, 'http://localhost').pathname); if (handler) handler(req, res); else { res.writeHead(404); res.end() } })
  const request = async (path, body, expected = 200) => {
    const response = await fetch(`${url}/plugins/dsh-elysium/${path}${path.includes('?') ? '&' : '?'}t=${token}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result
  }
  const record = (id, target) => ({ id, label: id, provider, connection_source: 'manual', instance_id: id, deployment_id: 'one', services: {
    comfyui: { transport: 'http', base_url: target.url, workload: 'minimax-h3' },
    llm: { transport: 'http', base_url: `${target.url}/v1`, model: 'qwen3.8-27b-elysium' } } })
  await request('server/register', { revision: 0, server: record('a', a) }, 201)
  await request('server/register', { revision: 1, server: record('b', b) }, 201)
  const select = async id => request('server/switch', { id, service: 'comfyui', revision: readRegistry().revision, selection_revision: readSelection().revision })
  await select('a')
  assert.equal(a.posts, 0, 'health checks must not generate')
  assert.equal((await backendLlmSettings(backendFromServer(readRegistry().servers.find(server => server.id === 'a'), 'llm'))).base_url, `${a.url}/v1`)
  assert.equal(await backendWorkflowSource(resolveServer()), a.url)
  const project = await request('project/create', { title: 'Adapter isolation', profile: 'preview', director: '张艺谋' }, 201)
  const projectId = project.id
  assert.match(projectId, /^[a-f0-9]{8}$/)
  a.failNext = true
  const initial = await startVideoJob({ project_id: projectId, mode: 't2va', profile: 'preview', prompt: 'A quiet garden.' })
  await completed(projectId, initial.job_id, 'failed')
  await select('b')
  a.history['prompt-1'].status = { completed: true }
  await resumeVideoJob(initial.job_id)
  const result = await completed(projectId, initial.job_id)
  assert.equal(a.posts, 1, 'resume reconciles original prompt'); assert.equal(b.posts, 0)
  assert.equal(result.server.provider, provider); assert.ok(result.result.comfyui_view_url.startsWith(a.url))
  const media = await fetch(`${url}/plugins/dsh-elysium/media/video?job=${initial.job_id}&t=${token}`)
  assert.equal(media.status, 200); assert.equal(await media.text(), 'fixture-media'); assert.equal(a.views, 1)
  assert.equal((await createComfyuiTaskStatusTool().execute({ server: 'a', prompt_id: 'prompt-1' })).status, 'succeeded')
  await createComfyuiTaskCancelTool().execute({ server: 'a', prompt_id: 'collision' })
  assert.equal(a.pending.length, 0); assert.equal(b.pending.length, 1)
  const switched = await startVideoJob({ project_id: projectId, mode: 't2va', profile: 'preview', prompt: 'A new scene on B.' })
  assert.ok((await completed(projectId, switched.job_id)).result.comfyui_view_url.startsWith(b.url))
  assert.equal(b.posts, 1)
  assert.equal((await backendLlmSettings(backendFromServer(readRegistry().servers.find(server => server.id === 'b'), 'llm'))).base_url, `${b.url}/v1`)
  await select('a')
  const manifest = validateProductionManifest({ version: 1, project_id: projectId, profile: 'preview', max_attempts: 2, shots: [
    { id: 'first', request: { mode: 't2va', prompt: 'A quiet garden.' }, produces_anchor: { id: 'garden', frame_index: 0 } },
    { id: 'second', request: { mode: 'i2va', prompt: 'The camera moves slowly.' }, media: { first_frame: { anchor: 'garden' } } },
  ] })
  assert.equal((await runProduction(manifest, { limit: 1, log() {} })).completed, 1)
  await select('b')
  const batch = await runProduction(manifest, { log() {} })
  assert.equal(batch.completed, 2); assert.equal(b.posts, 1, 'batch and references remain on original server')
  const posts = a.posts
  await runProduction(manifest, { log() {} }); assert.equal(a.posts, posts, 'completed batch does not resubmit')
  if (removed) {
    await assert.rejects(access(`src/servers/providers/${removed}`))
    await assert.rejects(access(`lib/servers/providers/${removed}`))
    const oldId = await createJob(projectId, { mode: 't2va', prompt: 'Old task' })
    const oldPath = jobPath(projectId, oldId)
    await saveJson(join(oldPath, 'input/backend.json'), { ...resolveServer(), provider: removed })
    await saveJson(join(oldPath, 'status.json'), { job_id: oldId, project_id: projectId, capability: 'workflow-video', backend: 'comfyui', status: 'failed' })
    await assert.rejects(resumeVideoJob(oldId), { code: 'PROVIDER_UNAVAILABLE' })
    assert.equal((await getJob(oldId)).error_code, 'PROVIDER_UNAVAILABLE')
    const registry = readRegistry(); await writeRegistry({ ...registry, servers: [...registry.servers, { ...record('old', { url: 'http://retired.invalid' }), provider: removed }] }, registry.revision)
    assert.equal((await request('server/list')).servers.find(server => server.id === 'old').provider_available, false)
    await request(`project/get?id=${projectId}`)
    const trace = (await readFile(process.env.PROVIDER_TRACE, 'utf8')).trim().split('\n').map(JSON.parse)
    for (const name of ['connect', 'createClient', 'buildGraph']) assert.ok(trace.some(entry => entry.name === name && entry.pid !== process.pid), `${name} dispatched inside real worker`)
    for (const name of ['validate', 'check', 'llmSettings', 'workflowSource']) assert.ok(trace.some(entry => entry.name === name), `${name} dispatched`)
  }
  console.log(`${provider}: build/import, registration/check/switch, real worker/recovery, atomic tasks, batch/reference, media and workflow source passed`)
} finally {
  for (const { project, id } of jobs) {
    const pid = await readFile(join(jobPath(project, id), 'worker.lock'), 'utf8').then(Number, () => 0)
    if (pid > 1) { try { process.kill(pid, 'SIGTERM') } catch {} }
  }
  await Promise.all(services.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })))
}
