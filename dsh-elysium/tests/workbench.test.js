import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

function fixture() {
  const project = { id: '12345678', title: '项目', anchors: [], acts: [{ title: '幕', shots: [{ role: '', action: '走路', subtitle: '', notes: '', mode: 't2va', job_id: null, status: 'pending' }] }], deliverables: [] }
  const modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { innerWidth: 2000, __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, addEventListener() {}, removeEventListener() {} }, URLSearchParams, URL, AbortController, setTimeout, clearTimeout,
    document: { body: { style: {}, setAttribute() {}, removeAttribute() {} }, documentElement: { style: { setProperty() {}, removeProperty() {} } }, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }, localStorage: { getItem() {}, setItem() {} },
    fetch: async url => ({ ok: true, json: async () => url.startsWith('/project/list') ? [project] : url.startsWith('/project/get') ? project : { items: [], total: 0 } }) })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require }
}
test('full workbench enters project, retains selected shot across tab switch and closes', async () => {
  const f = fixture(); let view
  await act(async () => { view = create(React.createElement(f.require('elysium/workbench').Workbench)) })
  await act(async () => view.root.findByProps({ 'aria-label': '打开创作工作台' }).props.onClick())
  assert.equal(view.root.findAllByProps({ 'aria-label': '继续制作 项目' }).length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '打开项目 项目' }).props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot-row' }).length, 1)
  await act(async () => view.root.findByProps({ 'aria-label': '镜 001' }).props.onClick())
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '素材').props.onClick())
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '项目').props.onClick())
  assert.ok(view.root.findByProps({ 'aria-label': '镜 001' }).props['aria-pressed'])
  await act(async () => view.unmount())
})

test('editor keeps draft after failed save and guards navigation until discard', async () => {
  const { require } = fixture(), guard = { current: null }
  let view, saved = 0, navigated = false, closed = false
  await act(async () => { view = create(React.createElement(require('elysium/dialog').Editor, { title: '编辑', initial: { title: '原内容' }, fields: [['title', '标题']], guard, close: () => { closed = true }, save: async () => { saved++; return false } })) })
  await act(async () => view.root.findByProps({ 'aria-label': '标题' }).props.onChange({ target: { value: '草稿' } }))
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '保存').props.onClick())
  assert.equal(saved, 1); assert.equal(closed, false)
  assert.equal(view.root.findByProps({ 'aria-label': '标题' }).props.value, '草稿')
  assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 1)
  await act(async () => guard.current(() => { navigated = true }))
  assert.equal(navigated, false)
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '放弃修改').props.onClick())
  assert.equal(navigated, true); assert.equal(closed, true)
  await act(async () => view.unmount())
  assert.equal(guard.current, null)
})

test('material filter changes abort old reads and late results cannot replace current results', async () => {
  const modules = new Map(), cache = new Map(), pending = []
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: (url, options) => new Promise(resolve => pending.push({ url, signal: options.signal, resolve: value => resolve({ ok: true, json: async () => value }) })) })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/materials').MaterialList)) })
  await act(async () => view.root.findByProps({ 'aria-label': '类型' }).props.onChange({ target: { value: 'image' } }))
  assert.equal(pending[0].signal.aborted, true)
  await act(async () => pending[1].resolve({ items: [{ job_id: 'b'.repeat(32), has_image: true, title: '新结果' }], total: 1 }))
  await act(async () => pending[0].resolve({ items: [{ job_id: 'a'.repeat(32), has_video: true, title: '过期结果' }], total: 1 }))
  assert.match(JSON.stringify(view.toJSON()), /新结果/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /过期结果/)
  assert.equal(view.root.findAllByType('video').length, 0)
  await act(async () => view.unmount())
  assert.equal(pending[1].signal.aborted, true)
})
