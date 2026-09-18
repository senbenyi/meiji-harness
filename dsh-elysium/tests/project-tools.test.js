// 职责：验证聊天工具的数据可见性、共享 Store 注册和实例配置隔离。
import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { apply, createDirectorTools, createProjectTools } from '../src/index.js'
import { createDirectorStore } from '../src/server/directors/service.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { withConfig } from '../src/config.js'
import { projectTools } from '../src/tools/agent/index.js'
import { generationProjectId } from '../src/tools/project/context.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/server/routes/projects.js'

test('chat tools read full objects, mutate one field and render compact mutation results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-tools-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const directors = createDirectorStore()
      await directors.create({ name: '测试导演', style: '测试风格', works: [] })
      const available = (await createDirectorTools(directors)[0].execute({})).directors
      assert.deepEqual(available.map(item => item.name), ['测试导演'])
      const store = createProjectStore({ directorExists: name => directors.has(name) }), definitions = createProjectTools(store)
      const tools = Object.fromEntries(definitions.map(tool => [tool.name, tool]))
      assert.equal(definitions.length, 6)
      const project = await tools.project_create.execute({ title: '测试', director: available[0].name, profile: 'preview' })
      const project_id = project.id
      await tools.project_update_act.execute({ project_id, action: 'add', title: '幕' })
      await tools.project_update_anchor.execute({ project_id, action: 'add', role: 'lin', patch: { label: '林' } })
      await tools.project_update_shot.execute({ project_id, action: 'add', act_index: 0, patch: { role: 'lin', action: '走路' } })
      const before = await tools.project_read.execute({ project_id })
      const rendered = JSON.parse(tools.project_read.output.render({}, before)[0].text)
      assert.equal(rendered.acts[0].shots[0].action, '走路')
      const id = rendered.acts[0].shots[0].id
      await tools.project_update_shot.execute({ project_id, action: 'update', id, patch: { subtitle: '你好' } })
      await tools.project_update_info.execute({ project_id, title: '新标题', anchors: [] })
      const value = await tools.project_read.execute({ project_id })
      assert.equal(value.anchors.length, 1)
      assert.equal(value.acts[0].shots[0].subtitle, '你好')
      assert.equal(value.acts[0].shots[0].action, '走路')
      assert.deepEqual(JSON.parse(tools.project_update_shot.output.render({}, value)[0].text), { id: project_id, title: '新标题', anchor_count: 1, shot_count: 1 })
      await assert.rejects(tools.project_update_shot.execute({ project_id, action: 'update', patch: { subtitle: 'bad' } }), /ID/)
      const visible = projectTools({ tools: definitions, sections: [] }, { session: { header: { agentPreset: 'elysium-director' }, snapshotEvents: () => [] } })
      assert.deepEqual(visible.tools, definitions)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('registered chat tools share HTTP project state and are disposed with the web context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-registration-'))
  const tools = new Map(), routes = new Map(), listeners = new Map(), disposers = []
  const web = { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } }
  const child = { get: name => name === 'webServer' ? web : undefined, on: (name, callback) => listeners.set(name, callback), effect: action => disposers.push(action()) }
  await withConfig({ ELYSIUM_STATE_ROOT: root }, () => createDirectorStore().create({ name: '测试导演', style: '测试风格', works: [] }))
  apply({ inject: (_deps, callback) => callback(child), on() {}, tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } }, { stateRoot: root })
  const rows = []; listeners.get('webserver/index-inject')(rows)
  const { token, projectBase } = rows[0].value
  const server = createServer((req, res) => routes.get(new URL(req.url, 'http://localhost').pathname)(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { directors } = await tools.get('director_list').execute({})
    const project = await tools.get('project_create').execute({ title: '注册测试', director: directors[0].name, profile: 'preview' })
    await tools.get('project_update_anchor').execute({ project_id: project.id, action: 'add', role: 'lin', patch: { description: '聊天保存' } })
    const value = await (await fetch(`http://127.0.0.1:${server.address().port}${projectBase}/get?t=${token}&id=${project.id}`)).json()
    assert.equal(value.anchors[0].description, '聊天保存')
    await assert.rejects(tools.get('project_create').execute({ title: '无效', director: '不存在', profile: 'preview' }), /导演不存在/)
    for (const dispose of disposers) dispose?.()
    assert.equal(tools.has('director_list'), false)
    assert.equal(tools.has('project_read'), false)
    assert.equal(routes.size, 0)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('free and teaching generation save tasks and media in an internal workspace absent from project lists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-free-project-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      for (const agentPreset of ['elysium-free', 'elysium-teaching']) {
        const exec = { agent: { session: { header: { agentPreset }, snapshotEvents: () => [] } } }
        assert.equal(await generationProjectId(undefined, exec), '00000000')
        assert.equal(await generationProjectId('abcd1234', exec), '00000000')
      }
      assert.equal(await generationProjectId('abcd1234', { agent: { session: { header: { agentPreset: 'elysium-director' }, snapshotEvents: () => [] } } }), 'abcd1234')
      assert.equal(JSON.parse(await readFile(join(root, 'projects', '00000000', 'project.json'))).internal, 'free')
      await access(join(root, 'projects', '00000000', 'jobs'))
      await access(join(root, 'projects', '00000000', 'media'))
      assert.deepEqual(await createProjectStore().list(), [])
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('object routes authenticate and retain chat edits between panel saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-object-http-'))
  const store = createProjectStore(), handler = createProjectHandler({ token: 't', projectStore: store })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  const request = (route, body) => fetch(`${base}/${route}?t=t`, { method: 'POST', body: JSON.stringify(body) })
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const tools = Object.fromEntries(createProjectTools(store).map(tool => [tool.name, tool]))
      const project = await store.change('create', { title: '交叉编辑', director: '导演', profile: 'preview' }), id = project.id
      await store.change('update', { id, acts: [{ title: '幕', shots: [] }] })
      assert.equal((await fetch(`${base}/poll?id=${id}&since=0`)).status, 401)
      assert.equal((await request('update-anchor', { id, action: 'add', data: { role: 'lin', label: '林' } })).status, 200)
      await tools.project_update_shot.execute({ project_id: id, action: 'add', act_index: 0, patch: { role: 'lin', action: '走路' } })
      const shotId = (await store.read(id)).acts[0].shots[0].id
      await tools.project_update_shot.execute({ project_id: id, action: 'update', id: shotId, patch: { subtitle: '聊天字幕' } })
      const response = await request('update-shot', { id, action: 'update', data: { id: shotId, notes: '手动备注' } })
      const result = await response.json()
      assert.equal(result.acts[0].shots[0].subtitle, '聊天字幕')
      assert.equal(result.acts[0].shots[0].notes, '手动备注')
      assert.equal(result.acts[0].shots[0].action, '走路')
      assert.equal((await request('update-shot', { id: '../bad', action: 'add', data: { act_index: 0 } })).status, 400)
    })
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
