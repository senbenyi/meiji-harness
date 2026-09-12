import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

function fixture() {
  const modules = new Map(), cache = new Map(), listeners = new Map(), storage = new Map()
  const document = { body: { style: { paddingRight: '7px', userSelect: 'text' } },
    addEventListener: (name, run) => listeners.set(name, run), removeEventListener: name => listeners.delete(name) }
  runInNewContext(clientSource(), { window: { innerWidth: 2000, __ELYSIUM_MEDIA__: { token: 'token', base: '/plugins/dsh-elysium/media' },
    __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, addEventListener() {}, removeEventListener() {} }, document, URLSearchParams,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async () => ({ ok: true, json: async () => ({ items: [], has_more: false }) }) })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, document, listeners, storage }
}

test('panel restores state, clamps drag width and restores body styles on collapse and unmount', async () => {
  const f = fixture(), { AssetPanel } = f.require('elysium-tools/asset-panel')
  let toggle, view
  const toggleRoot = { render: element => { toggle = element } }
  await act(async () => { view = create(React.createElement(AssetPanel, { toggleRoot })) })
  assert.equal(view.toJSON(), null)
  await act(async () => toggle.props.onClick())
  assert.equal(view.root.findByType('aside').props.style.width, 200)
  assert.equal(f.document.body.style.paddingRight, '200px')
  await act(async () => view.root.findByProps({ className: 'elysium-panel-resize' }).props.onMouseDown({ preventDefault() {} }))
  assert.equal(f.document.body.style.userSelect, 'none')
  await act(async () => f.listeners.get('mousemove')({ clientX: 100 }))
  assert.equal(view.root.findByType('aside').props.style.width, 1000)
  await act(async () => f.listeners.get('mouseup')())
  assert.equal(f.document.body.style.userSelect, 'text')
  await act(async () => view.unmount())
  assert.equal(f.document.body.style.paddingRight, '7px')
  await act(async () => { view = create(React.createElement(AssetPanel, { toggleRoot })) })
  assert.equal(view.root.findByType('aside').props.style.width, 1000)
  await act(async () => toggle.props.onClick())
  assert.equal(f.document.body.style.paddingRight, '7px')
  await act(async () => view.unmount())
  assert.equal(f.listeners.size, 0)
})

test('storyboard detail persists edits, adds, reorders, replaces and removes shots', async () => {
  const modules = new Map(), cache = new Map(), requests = []
  let board = { id: 'abcdef12', title: '分镜', shots: [{ index: 1, label: 'A', prompt: '', notes: '', status: 'succeeded', job_id: 'a'.repeat(32) }, { index: 2, label: 'B', prompt: '', notes: '', status: 'pending', job_id: null }] }
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/plugins/dsh-elysium/media' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams,
    fetch: async (url, options) => {
      requests.push(url)
      if (options.body) board = { ...board, ...JSON.parse(options.body) }
      return { ok: true, json: async () => url.includes('/media/') ? { has_video: true, comfyui_view_url: 'https://model.test/view' } : structuredClone(board) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium-tools/storyboard').StoryboardDetail, { id: board.id, back() {} })) })
  const click = async text => act(async () => view.root.findAllByType('button').find(button => button.children.join('') === text).props.onClick())
  assert.equal(view.root.findByType('video').props.src, 'https://model.test/view')
  await click('↓')
  assert.deepEqual(board.shots.map(shot => shot.label), ['B', 'A'])
  await act(async () => view.root.findAllByType('button').filter(button => button.children.join('') === '替换')[1].props.onClick())
  assert.equal(board.shots[1].job_id, null); assert.equal(board.shots[1].status, 'pending')
  await click('添加镜头')
  assert.equal(board.shots.length, 3)
  const notes = () => view.root.findAllByType('textarea').find(field => field.props['aria-label'] === '镜头备注')
  await act(async () => notes().props.onChange({ target: { value: '新备注' } }))
  await act(async () => notes().props.onBlur())
  assert.equal(board.shots[0].notes, '新备注')
  await click('移除')
  assert.equal(board.shots.length, 2)
  assert.ok(requests.every(url => url.includes('t=t')))
  await act(async () => view.unmount())
})
