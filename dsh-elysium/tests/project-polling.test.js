// 职责：验证轮询刷新、未提交编辑保护、保存及项目切换期间的异步竞争。
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

const initial = () => ({ id: 'abcdef12', title: '项目', director: '张艺谋', profile: 'preview', updated_at: 1,
  anchors: [{ role: 'lin', label: '林', description: '', image_url: '', source: null }],
  acts: [{ title: '幕', shots: [{ id: 'shot-1', role: 'lin', action: '走路', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' }] }], deliverables: [] })

function fixture() {
  let project = initial(), hold = null, nextTimer = 0
  const modules = new Map(), cache = new Map(), timers = new Map(), requests = [], pending = []
  const response = value => ({ ok: true, json: async () => structuredClone(value) })
  runInNewContext(clientSource(), { URLSearchParams, URL, AbortController,
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id }, clearTimeout: id => timers.delete(id),
    document: {}, window: { confirm: () => true, __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' }, __ModuleLoader__: { load: module => modules.set(module.id, module.factory) } },
    fetch: async (url, options) => {
      requests.push(url)
      const path = new URL(url, 'http://localhost').pathname
      if (path === hold) return new Promise(resolve => pending.push(value => resolve(response(value))))
      if (path === '/director/list') return response([{ name: '张艺谋' }])
      if (path === '/project/poll') return response({ updated: project.updated_at > Number(new URL(url, 'http://localhost').searchParams.get('since')) })
      if (path === '/project/update') project = { ...project, ...JSON.parse(options.body), updated_at: project.updated_at + 1 }
      return response(project)
    },
  })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return {
    Component: require('elysium/projects').ProjectDetail, requests, pending, timers,
    change: patch => { project = { ...project, ...patch, updated_at: project.updated_at + 1 }; return project },
    hold: path => { hold = path },
    tick: async () => { const due = [...timers]; timers.clear(); await act(async () => { for (const [, timer] of due) { assert.equal(timer.delay, 4000); await timer.callback() } }) },
    startTick: () => { const [id, timer] = [...timers][0]; timers.delete(id); return timer.callback() },
  }
}
const click = (view, label) => act(async () => view.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.join('') === label).props.onClick())
const edit = (view, label, value) => act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
async function mount(f, tab = 'anchors') {
  let view
  await act(async () => { view = create(React.createElement(f.Component, { id: 'abcdef12', viewState: { projectTab: tab }, back() {} })) })
  return view
}

test('project settings draft survives a remote update and refreshes after leaving the form', async () => {
  const f = fixture(), view = await mount(f, 'project')
  await edit(view, '项目名称', '手动草稿')
  f.change({ title: '聊天标题' })
  await f.tick()
  assert.equal(view.root.findByProps({ 'aria-label': '项目名称' }).props.value, '手动草稿')
  assert.match(JSON.stringify(view.toJSON()), /项目已有新修改/)
  assert.equal(f.requests.filter(path => path.startsWith('/project/get')).length, 1)
  await click(view, '锚点')
  await f.tick()
  assert.equal(view.root.findByType('h1').children.join(''), '聊天标题')
  await act(async () => view.unmount())
})

test('late results from a previous project are ignored after switching projects', async () => {
  const f = fixture(), view = await mount(f)
  f.hold('/project/poll')
  let polling
  await act(async () => { polling = f.startTick(); await Promise.resolve() })
  f.change({ id: '12345678', title: '另一个项目' })
  f.hold(null)
  await act(async () => view.update(React.createElement(f.Component, { id: '12345678', viewState: { projectTab: 'anchors' }, back() {} })))
  const reads = f.requests.filter(path => path.startsWith('/project/get')).length
  await act(async () => { f.pending[0]({ updated: true }); await polling })
  assert.equal(f.requests.filter(path => path.startsWith('/project/get')).length, reads)
  assert.equal(view.root.findByType('h1').children.join(''), '另一个项目')
  await act(async () => view.unmount())
  assert.equal(f.timers.size, 0)
})
