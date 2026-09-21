// 职责：验证项目草稿生成使用所选导演、不落库，并在工作台填充可编辑表单。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { withConfig } from '../src/config.js'
import { createSkillsStore } from '../src/database/managers/skills.js'
import { createDirectorStore } from '../src/database/managers/directors.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/server/routes/projects.js'
import { clientSource } from '../scripts/loader.js'

test('project suggestion uses the selected director and returns a validated draft without saving', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-suggest-'))
  const config = { ELYSIUM_STATE_ROOT: root }
  let server
  try {
    await withConfig(config, async () => {
      await createSkillsStore().seed('drama-planning', new URL('../../harness/.dsh/storages/elysium/pools/skills/drama-planning/', import.meta.url).pathname)
      const directors = createDirectorStore(), first = await directors.create({ display_name: '导演甲' }), second = await directors.create({ display_name: '导演乙' })
      await createSkillsStore().saveReference(second.name, 'script.md', '导演乙的剧本节奏')
      const requests = [], outputs = [{ title: ' 新片 ', genre: ' 悬疑 ', synopsis: ' 一封信引出秘密 ' }, { title: '', genre: '悬疑', synopsis: '故事' }]
      const store = createProjectStore({ complete: async request => { requests.push(request); return outputs.shift() } })
      const handler = createProjectHandler({ token: 't', directorStore: directors, projectStore: store })
      server = createServer((req, res) => withConfig(config, () => handler(req, res)))
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const url = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/project-suggest?t=t`
      const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await post({ director: second.name })
      assert.equal(result.status, 200)
      assert.deepEqual(await result.json(), { title: '新片', genre: '悬疑', synopsis: '一封信引出秘密' })
      assert.match(requests[0].system, /导演乙的剧本节奏/)
      assert.equal(requests[0].name, 'project_draft')
      assert.deepEqual(await store.list(), [])
      assert.equal((await post({ director: first.name })).status, 502)
      assert.deepEqual(await store.list(), [])
      assert.equal((await post({ director: '' })).status, 400)
    })
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('project form defaults to first director and robot fills fields before explicit creation', async () => {
  const modules = new Map(), cache = new Map(), requests = []
  const directors = [{ name: 'director-first', display_name: '第一导演' }, { name: 'director-second', display_name: '第二导演' }]
  let project, suggestFailure = false
  runInNewContext(clientSource(), { URLSearchParams, URL, setTimeout, clearTimeout, AbortController,
    window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' },
      __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, document: {},
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      requests.push({ url, body })
      const reply = value => ({ ok: true, json: async () => structuredClone(value) })
      if (url.startsWith('/director/list')) return reply(directors)
      if (url.startsWith('/project/list')) return reply([])
      if (url.startsWith('/project/project-suggest')) return suggestFailure ? { ok: false, json: async () => ({ error: '模型暂时不可用' }) }
        : reply({ title: '自动片名', genre: '悬疑', synopsis: '一封信引出秘密' })
      if (url.startsWith('/project/create')) { project = { id: '1234abcd', ...body, updated_at: 1, anchors: [], episodes: [], auto: { enabled: false, anchors_confirmed: false, attempts: {} } }; return reply(project) }
      if (url.startsWith('/project/get')) return reply(project)
      if (url.startsWith('/project/plan-read')) return reply({ series: { versions: [], finalized: null }, episodes: {} })
      return reply(project)
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/projects').ProjectList)) })
  await act(async () => view.root.findByProps({ 'aria-label': '新建项目' }).props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '项目导演' }).props.value, 'director-first')
  assert.equal(view.root.findAllByType('option')[0].props.value, 'director-first')
  assert.equal(view.root.findAllByProps({ 'aria-label': '选择封面图片' }).length, 0)
  assert.ok(view.root.findByProps({ 'aria-label': '项目题材' }))
  await act(async () => view.root.findByProps({ 'aria-label': '项目导演' }).props.onChange({ target: { value: 'director-second' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '机器人自动生成' }).props.onClick())
  assert.deepEqual(requests.find(item => item.url.startsWith('/project/project-suggest')).body, { director: 'director-second' })
  assert.equal(requests.some(item => item.url.startsWith('/project/create')), false)
  assert.equal(view.root.findByProps({ 'aria-label': '项目名称' }).props.value, '自动片名')
  suggestFailure = true
  await act(async () => view.root.findByProps({ 'aria-label': '机器人自动生成' }).props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '项目名称' }).props.value, '自动片名')
  assert.match(JSON.stringify(view.toJSON()), /模型暂时不可用/)
  await act(async () => view.root.findByProps({ 'aria-label': '项目名称' }).props.onChange({ target: { value: '手改片名' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.deepEqual(requests.find(item => item.url.startsWith('/project/create')).body, { title: '手改片名', director: 'director-second', genre: '悬疑', synopsis: '一封信引出秘密' })
  assert.ok(view.root.findByProps({ 'aria-label': '机器人自动生成' }))
  await act(async () => view.unmount())
})
