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
  runInNewContext(clientSource(), { window: { innerWidth: 2000, __ELYSIUM_MEDIA__: { token: 'token', base: '/plugins/dsh-elysium/media', projectBase: '/plugins/dsh-elysium/project' },
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

test('panels use authenticated preview URLs and deletion requires explicit confirmation', async () => {
  const modules = new Map(), cache = new Map(), requests = [], confirmations = []
  let confirmed = false, deleted = false
  const mediaBase = '/tunnel/media/plugins/dsh-elysium/media', projectBase = '/custom/projects'
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: mediaBase, projectBase },
    __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: message => { confirmations.push(message); return confirmed } }, URLSearchParams,
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (url.startsWith(mediaBase)) return { ok: true, json: async () => ({ has_more: false, items: [
        { job_id: 'a'.repeat(32), has_video: true, comfyui_view_url: 'http://internal/view.mp4' },
        { job_id: 'b'.repeat(32), has_image: true, comfyui_view_url: 'http://internal/view.png' },
      ] }) }
      assert.ok(url.startsWith(projectBase + '/'))
      if (url.startsWith(projectBase + '/delete?')) deleted = true
      return { ok: true, json: async () => deleted ? [] : [{ id: 'aaaaaaaa', title: '重要分镜', shot_count: 0, completed_count: 0 }] }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium-tools/asset-list').MaterialList)) })
  assert.equal(view.root.findByType('video').props.src, `${mediaBase}/video?job=${'a'.repeat(32)}&t=t`)
  assert.equal(view.root.findByType('img').props.src, `${mediaBase}/image?job=${'b'.repeat(32)}&t=t`)
  await act(async () => view.unmount())
  await act(async () => { view = create(React.createElement(require('elysium-tools/project').ProjectList)) })
  const clickDelete = () => view.root.findAllByType('button').find(button => button.children.join('') === '删除项目').props.onClick()
  await act(async () => clickDelete())
  assert.equal(deleted, false)
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 0)
  confirmed = true
  await act(async () => clickDelete())
  assert.equal(deleted, true); assert.equal(confirmations.length, 2)
  assert.match(confirmations[0], /重要分镜/)
  const deletion = requests.find(request => request.options.method === 'POST')
  assert.equal(deletion.url, `${projectBase}/delete?t=t`)
  assert.equal(JSON.parse(deletion.options.body).id, 'aaaaaaaa')
  await act(async () => view.unmount())
})
