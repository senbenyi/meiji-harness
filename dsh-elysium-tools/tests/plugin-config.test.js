import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { resolveConfig, withConfig, requiredConfig, workerEnvironment } from '../src/config.js'
import { apply } from '../src/index.js'
import { mockComfy } from './helpers/comfy-server.js'
import { mockMedia } from './helpers/media-server.js'

const keys = ['MINIMAX_H3_COMFYUI_URL', 'MINIMAX_H3_COMFYUI_PUBLIC_URL', 'ARTIFACTS_ROOT',
  'ELYSIUM_TOOLS_STATE_ROOT', 'MINIMAX_H3_COMFYUI_OUTPUT_ROOT', 'HARNESS_PYTHON', 'FFMPEG_BIN', 'FFPROBE_BIN']
for (const key of keys) delete process.env[key]

test('plugin config validates explicit values, defaults local paths and isolates concurrent calls', async () => {
  assert.ok(resolveConfig().ARTIFACTS_ROOT.endsWith('/elysium/artifacts'))
  for (const config of [{ comfyUrl: 'ftp://host' }, { publicUrl: '' }, { stateRoot: 'relative' },
    { python: null }, { ffprobe: 12 }, { enableAtomicTools: '1' }, { typo: '/path' }]) assert.throws(() => resolveConfig(config))
  const configs = ['/tmp/instance-a', '/tmp/instance-b'].map(artifactsRoot => resolveConfig({ artifactsRoot }))
  const values = await Promise.all(configs.map(config => withConfig(config, async () => {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(workerEnvironment().ARTIFACTS_ROOT, config.ARTIFACTS_ROOT)
    return requiredConfig('ARTIFACTS_ROOT')
  })))
  assert.deepEqual(values, ['/tmp/instance-a', '/tmp/instance-b'])
  assert.equal(process.env.ARTIFACTS_ROOT, undefined)
})

function install(config) {
  const tools = new Map(), routes = new Map(), listeners = new Map()
  const media = { get: name => name === 'webServer' ? { register: route => routes.set(route.path, route.handler) } : undefined,
    on: (name, callback) => listeners.set(name, callback), effect: callback => callback() }
  apply({ inject: (_deps, callback) => callback(media), on() {}, tools: { register: tool => tools.set(tool.name, tool) } }, config)
  const rows = []
  listeners.get('webserver/index-inject')(rows)
  return { tools, routes, token: rows[0].value.token }
}

test('independent plugin instances run workers, recover media and serve session artifacts without launcher env', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-plugin-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const videoBackend = await mockComfy(root), imageBackend = await mockMedia(root)
  t.after(() => videoBackend.close()); t.after(() => imageBackend.close())
  const config = (backend, name) => ({ comfyUrl: backend.url, publicUrl: backend.url,
    artifactsRoot: join(root, name, 'artifacts'), stateRoot: join(root, name, 'state'),
    python: 'python3', ffprobe: 'ffprobe' })
  const video = install(config(videoBackend, 'video')), image = install(config(imageBackend, 'image'))
  imageBackend.controls.fail = true
  const exec = { agent: { session: { id: 'session' } }, callId: 'call' }
  const [movie, failed] = await Promise.all([
    video.tools.get('workflow_generate_video').execute({ duration: 1, prompts: ['independent worker'] }, exec),
    image.tools.get('workflow_generate_image').execute({ prompt: 'independent image' }, exec).catch(error => error),
  ])
  assert.equal(movie.status, 'succeeded', movie.error)
  assert.equal(movie.server_path, undefined)
  assert.equal(movie.path, movie.comfyui_view_url)
  assert.ok(failed instanceof Error)
  const id = failed.message.match(/[0-9a-f]{32}/)?.[0]
  assert.ok(id)
  imageBackend.controls.fail = false
  const picture = await image.tools.get('model_job_resume').execute({ job_id: id }, exec)
  assert.equal(picture.status, 'succeeded')
  assert.equal(picture.job_id, id)
  assert.equal(picture.server_path, undefined)
  assert.equal(picture.path, picture.comfyui_view_url)
  assert.equal(imageBackend.prompts.length, 2)
  for (const [plugin, expected] of [[video, movie], [image, picture]]) {
    const server = createServer((req, res) => plugin.routes.get(new URL(req.url, 'http://local').pathname)(req, res))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media`
      const query = new URLSearchParams({ session: 'session', call: 'call', t: plugin.token })
      const status = await (await fetch(`${base}/status?${query}`)).json()
      assert.equal(status.job_id, expected.job_id)
      assert.equal(status.status, 'succeeded')
      const response = await fetch(`${base}/${expected.media_kind === 'image' ? 'image' : 'video'}?${query}`, { redirect: 'manual' })
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('location'), expected.comfyui_view_url)
      assert.equal(await response.text(), '')
    } finally { await new Promise(resolve => server.close(resolve)) }
  }
  for (const key of keys) assert.equal(process.env[key], undefined, key)
})
