import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

function fixture(fetch) {
  const modules = new Map(), cache = new Map(), slots = [], timers = new Map(), opened = []
  let next = 0
  runInNewContext(clientSource(), { window: { __ELYSIUM_PROJECTS__: { base: '/projects', token: 'test' },
    __ModuleLoader__: { load: entry => modules.set(entry.id, entry.factory) } }, URLSearchParams, AbortController, fetch,
    setTimeout: fn => { timers.set(++next, fn); return next }, clearTimeout: id => timers.delete(id) })
  const require = id => {
    if (id === 'react') return React
    if (!cache.has(id)) cache.set(id, modules.get(id)(require))
    return cache.get(id)
  }
  const ctx = { sessions: { create: async value => { opened.push(value) }, open: value => opened.push(value) },
    slots: { inject: (_, fn) => fn(), register: (spec, component) => slots.push({ spec, component }) } }
  ctx.inject = (_, fn) => fn(ctx)
  require('elysium-ui/projects').apply(ctx)
  return { slots, timers, opened }
}
const response = value => ({ ok: true, json: async () => value })
const button = (view, name) => view.root.findAllByType('button').find(b => b.children.join('') === name)

test('new project opens its fixed host session and preserves the project after an opening failure', async () => {
  const requests = []
  let rows = [], failOpen = true
  const f = fixture(async (url, options) => {
    const data = options.body ? JSON.parse(options.body) : null; requests.push(data)
    if (!data) return response(rows)
    if (data.action === 'create') { rows = [{ id: 'p', name: data.name }]; return response(rows[0]) }
    if (failOpen) return { ok: false, json: async () => ({ error: '会话暂不可用' }) }
    return response({ sessionId: 'fixed-session', cwd: '/projects/p' })
  })
  const slot = f.slots.find(s => s.spec.name === 'sidebar.footer.action')
  let view
  await act(async () => { view = create(React.createElement(slot.component, slot.spec.inject())) })
  await act(async () => button(view, '我的短剧').props.onClick())
  await act(async () => view.root.findByType('input').props.onChange({ target: { value: '江湖' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.match(JSON.stringify(view.toJSON()), /会话暂不可用/)
  assert.equal(f.opened.length, 0)
  failOpen = false
  await act(async () => button(view, '江湖').props.onClick())
  assert.deepEqual(JSON.parse(JSON.stringify(f.opened)), [{ sessionId: 'fixed-session', cwd: '/projects/p' }, 'fixed-session'])
  assert.equal(requests.filter(r => r?.action === 'create').length, 1)
  await act(async () => view.unmount())
})
test('project panel restores media, adopts only on click, and clears polling on session change/unmount', async () => {
  const requests = []
  const project = { id: 'p', name: '江湖', assets: [], exports: [], jobs: [{ jobId: 'j', status: 'succeeded', has_video: true }] }
  const f = fixture(async (url, opts) => {
    requests.push({ url, data: opts.body ? JSON.parse(opts.body) : null })
    if (opts.body) { project.exports = [{ jobId: 'j' }]; return response(project) }
    return response(url.includes('session=s2') ? null : project)
  })
  const slot = f.slots.find(s => s.spec.name === 'conversation.input.dock')
  let view
  await act(async () => { view = create(React.createElement(slot.component, { sessionId: 's1' })) })
  await act(async () => button(view, '素材与成片').props.onClick())
  assert.equal(view.root.findAllByType('video').length, 1)
  assert.equal(requests.filter(r => r.data).length, 0)
  await act(async () => button(view, '采用成片').props.onClick())
  assert.deepEqual(JSON.parse(JSON.stringify(requests.find(r => r.data).data)), { action: 'adopt', id: 'p', jobId: 'j' })
  assert.equal(button(view, '已采用').props.disabled, true)
  await act(async () => view.update(React.createElement(slot.component, { sessionId: 's2' })))
  assert.equal(view.toJSON(), null)
  assert.equal(f.timers.size, 0)
  await act(async () => view.unmount())
  assert.equal(f.timers.size, 0)
})

test('late mutation response from a previous project never replaces the newly selected project', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const first = { id: 'p1', name: '第一部', assets: [], exports: [], jobs: [{ jobId: 'j', status: 'succeeded', has_video: true }] }
  const second = { id: 'p2', name: '第二部', assets: [], exports: [], jobs: [] }
  const f = fixture(async (url, opts) => opts.body ? pending : response(url.includes('session=s2') ? second : first))
  const slot = f.slots.find(s => s.spec.name === 'conversation.input.dock')
  let view, mutation
  await act(async () => { view = create(React.createElement(slot.component, { sessionId: 's1' })) })
  await act(async () => button(view, '素材与成片').props.onClick())
  act(() => { mutation = button(view, '采用成片').props.onClick() })
  await act(async () => view.update(React.createElement(slot.component, { sessionId: 's2' })))
  await act(async () => { finish(response(first)); await mutation })
  assert.match(JSON.stringify(view.toJSON()), /第二部/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /第一部/)
  await act(async () => view.unmount())
})
