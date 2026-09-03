import assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import test from 'node:test'
import { projectCreate } from '../../src/application/project-service.js'
import { apply } from '../../src/presentation/dsh/studio-host.js'

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body += String(body)
    },
    write(body) { this.body += String(body) },
  }
}

function jsonRequest(url, body) {
  const request = Readable.from([JSON.stringify(body)])
  request.method = 'POST'
  request.url = url
  request.headers = {}
  return request
}

test('rejects untrusted requests before every Elysium route', async () => {
  const routes = []
  let cleanup = () => {}
  const scope = {
    tools: { get() { return undefined } },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(callback) {
      cleanup = callback()
      return cleanup
    },
  }
  const ctx = {
    tools: scope.tools,
    inject(_services, callback) {
      callback(scope)
      return () => {}
    },
  }

  apply(ctx, {}, () => false)

  assert.deepEqual(routes.map(route => route.path), [
    '/elysium/api',
    '/elysium/file',
    '/elysium/factory-file',
    '/elysium/import-image',
  ])
  for (const route of routes) {
    const response = responseRecorder()
    await route.handler({ method: 'POST', url: route.path, headers: {} }, response)
    assert.equal(response.status, 403, route.path)
  }
  cleanup()
})

test('episode create route saves a draft without invoking the planner', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-route-test-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const project = await projectCreate({ workspace }, { title: '先保存项目' })
  const routes = []
  let cleanup = () => {}
  const scope = {
    tools: { get() { return undefined } },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(callback) {
      cleanup = callback()
      return cleanup
    },
  }
  const ctx = {
    tools: scope.tools,
    inject(_services, callback) {
      callback(scope)
      return () => {}
    },
  }
  apply(ctx, { workspace }, () => true)
  t.after(cleanup)

  const response = responseRecorder()
  const api = routes.find(route => route.path === '/elysium/api')
  await api.handler(jsonRequest('/elysium/api/episode.create', {
    projectId: project.project.id,
    episodeId: 'episode-01',
    title: '第一集',
    sourceText: '先保存故事，再决定何时自动规划。',
    targetDurationSec: 10,
  }), response)

  assert.equal(response.status, 200)
  assert.equal(JSON.parse(response.body).plan.source, 'auto-draft')
})

test('streams project media with byte-range support for video playback', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-media-route-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const project = await projectCreate({ workspace }, { title: '视频交付' })
  const relative = 'output/final.mp4'
  await writeFile(path.join(workspace, 'projects', project.project.id, relative), '0123456789')
  const routes = []
  let cleanup = () => {}
  const scope = {
    tools: { get() { return undefined } },
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(callback) { cleanup = callback(); return cleanup },
  }
  apply({ tools: scope.tools, inject(_services, callback) { callback(scope); return () => {} } }, { workspace }, () => true)
  t.after(cleanup)

  const response = responseRecorder()
  const media = routes.find(route => route.path === '/elysium/file')
  await media.handler({ method: 'GET', url: `/elysium/file?project=${project.project.id}&path=${encodeURIComponent(relative)}`, headers: { range: 'bytes=2-5' } }, response)

  assert.equal(response.status, 206)
  assert.equal(response.headers['content-range'], 'bytes 2-5/10')
  assert.equal(response.headers['accept-ranges'], 'bytes')
  assert.equal(response.body, '2345')
})
