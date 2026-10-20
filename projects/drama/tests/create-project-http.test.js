import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { CreateProjectTool } from '../src/tools/creat_project_tool.js'
import { createProjectHttpHandler } from '../src/http/project_routes.js'
import { mount } from '../src/client/workbench.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'drama-http-'))
  const tool = new CreateProjectTool({ root,
    workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} },
    sessionController: { create: async () => ({ sessionId: `session-${randomUUID()}` }) },
  })
  const handler = createProjectHttpHandler(tool, { authorize: req => req.headers['x-test-user'] ? null : 401 })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => { handler.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { 'X-Test-User': '1', ...options.headers } })
  return { tool, request, base }
}

test('真实 HTTP：鉴权、UI模块、会话隔离快照及创建完成 SSE', async t => {
  const { tool, request, base } = await fixture(t)
  assert.equal((await fetch(base + '/api/drama/project?session_id=other')).status, 401)
  for (const name of ['panel.js', 'workbench.js', 'project-ui.css'])
    assert.equal((await request('/plugins/drama/src/client/' + name)).status, 200)
  const id = `session-${randomUUID()}`
  const abort = new AbortController()
  t.after(() => abort.abort())
  const events = await request('/api/drama/events?session_id=' + id, { signal: abort.signal })
  const reader = events.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /refresh/)
  const result = await tool.create({ name: '实时项目' }, { sessionId: id, requestId: 'http' })
  const message = new TextDecoder().decode((await reader.read()).value)
  assert.match(message, /created/); assert.ok(message.includes(result.project_id))
  const snapshot = await (await request('/api/drama/project?session_id=' + id)).json()
  assert.equal(snapshot.project.basic_info.name, '实时项目')
  assert.deepEqual(await (await request('/api/drama/project?session_id=other')).json(), { project: null })
  assert.equal((await request('/api/drama/projects?session_id=other', { method: 'POST', body: '{}' })).status, 403)
  abort.abort()
})

test('UI收到会话工具创建事件后重新读取JSON快照、刷新项目名并选择项目新会话', async t => {
  const { tool, request } = await fixture(t)
  const dom = new JSDOM('<main></main>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  let stream, selected
  class Events {
    constructor() { stream = this }
    close() {}
  }
  const id = `session-${randomUUID()}`
  const root = document.querySelector('main')
  const ui = mount(root, { getSessionId: () => id, fetcher: request, Events, selectSession: value => { selected = value } })
  t.after(() => ui.dispose())
  await ui.refresh()
  assert.ok(root.querySelector('.home-empty [aria-label="创建项目"]'))
  assert.equal(root.querySelector('button.library').textContent, '片库')
  assert.equal(root.querySelector('button.settings').textContent, '设置')
  await root.querySelector('button.settings').onclick()
  assert.equal(root.querySelector('.settings-page h2').textContent, '设置')
  root.querySelector('.settings-page button').click()
  assert.ok(root.querySelector('.home-empty'))
  const result = await tool.create({ name: '界面刷新' }, { sessionId: id, requestId: 'ui' })
  stream.onmessage({ data: JSON.stringify({ type: 'created', ...result }) })
  for (let i = 0; i < 50 && !selected; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(root.querySelector('h2').textContent, '界面刷新')
  assert.equal(selected, result.session_id)
  assert.match(root.textContent, /原始剧本/)
})
