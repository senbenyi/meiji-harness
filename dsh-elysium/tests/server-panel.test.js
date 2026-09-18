// 职责：验证模型面板固定列出全部选项，并在当前选择右侧展示连接状态。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

function group(view, label) {
  return view.root.findByProps({ className: 'elysium-model-group', 'aria-label': label })
}
function radios(view, label) {
  return group(view, label).findAll(node => node.props?.role === 'radio')
}
function radio(view, label) {
  return view.root.findByProps({ role: 'radio', 'aria-label': label })
}
function connectButton(view, label) {
  return group(view, label)?.findAllByType('button').find(button => button.children.join('') === '连接')
}
function statusText(view, label) {
  return group(view, label)?.findAllByProps({ role: 'status' }).at(-1)?.children.join('') || ''
}
function rowStatus(view, label) {
  return radio(view, label).parent.findAllByProps({ role: 'status' }).at(-1)?.children.join('') || ''
}
function rowConnect(view, label) {
  return radio(view, label).parent.findAllByType('button').find(button => button.children.join('') === '连接')
}
async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve() })
}

test('model panel lists private and third-party models and switches the current selection', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  const data = { revision: 1, models: { image: [], video: [{ id: 'a', label: '视频 A' }, { id: 'b', label: '视频 B' }] }, selected: { image: '', video: 'a' }, origin: { image: '', video: 'own' }, chat_model: { id: 'qwen3.8-27b-elysium', label: 'qwen3.8' },
    third_party: { video: [{ id: 'bailian:wan26', label: 'Wan 2.6' }, { id: 'byteplus:seedance2', label: 'Seedance 2.0' }] }, third_party_selected: { image: '', video: 'bailian:wan26' },
    third_party_channels: [{ id: 'bailian', label: '百炼万相', enabled: true, preferred: true, models: ['wan2.6-t2v', 'wan2.6-i2v'] }, { id: 'byteplus', label: 'Seedance 2.0', enabled: true, preferred: false, models: ['seedance'] }] }
  let failing = true, holding = false, release, chatFailing = true, chatHolding = false, releaseChat
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'token', settingsBase: '/prefix/settings' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController,
    fetch: async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      calls.push({ url, body }); assert.match(url, /^\/prefix\/settings\/.+\?t=token$/)
      if (url.includes('/tunnel-connect')) {
        if (chatFailing) return { ok: false, json: async () => ({ error: '隧道连接失败' }) }
        if (chatHolding) await new Promise(resolve => { releaseChat = resolve })
        return { ok: true, json: async () => ({ connected: true }) }
      }
      if (url.includes('/model-status')) return { ok: true, json: async () => ({ connected: false }) }
      if (url.includes('/model-connect')) {
        if (failing) return { ok: false, json: async () => ({ error: '模型检查失败' }) }
        if (holding) await new Promise(resolve => { release = resolve })
        data.selected[body.kind] = body.id; data.origin = { ...data.origin, [body.kind]: 'own' }; data.revision++
        return { ok: true, json: async () => ({ connected: true, revision: data.revision }) }
      }
      if (url.includes('/third-party-select')) {
        data.third_party_selected[body.kind] = body.id; data.selected[body.kind] = ''; data.origin = { ...data.origin, [body.kind]: 'third' }; data.revision++
        return { ok: true, json: async () => ({ revision: data.revision, selected: body.id }) }
      }
      return { ok: true, json: async () => structuredClone(data) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/settings').Settings)) })
  await flush()
  assert.equal(view.root.findAllByType('select').length, 0)
  assert.equal(rowStatus(view, 'qwen3.8（私有）'), '连接失败')
  assert.equal(connectButton(view, '聊天模型').children.join(''), '连接')
  assert.equal(rowStatus(view, '视频 A（私有）'), '连接失败')
  assert.equal(rowConnect(view, '视频 A（私有）').children.join(''), '连接')
  assert.equal(connectButton(view, '图片模型'), undefined)
  assert.equal(radio(view, 'qwen3.8（私有）').props['aria-checked'], true)
  assert.deepEqual(radios(view, '视频模型').map(item => item.props['aria-label']), ['视频 A（私有）', '视频 B（私有）', 'Wan 2.6（三方）', 'Seedance 2.0（三方）'])
  assert.equal(radio(view, '视频 A（私有）').props['aria-checked'], true)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /已启用|已关闭|三方视频首选|wan2\.6-t2v|wan2\.6-i2v|三方模型|私有模型/)
  assert.equal(group(view, '图片模型').findByType('p').children.join(''), '未配置')
  assert.equal(radios(view, '图片模型').length, 0)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /手工登记|添加视频|添加聊天|未接入|刷新列表/)
  assert.equal(calls.filter(call => call.url.includes('/tunnel-connect')).length, 1)
  assert.equal(calls.filter(call => call.url.includes('/model-status') && call.body.kind === 'video').length, 1)
  assert.equal(calls.filter(call => call.url.includes('/model-connect') && call.body.kind === 'video').length, 1)
  await act(async () => connectButton(view, '聊天模型').props.onClick())
  assert.equal(rowStatus(view, 'qwen3.8（私有）'), '连接失败')
  assert.equal(connectButton(view, '聊天模型').props.disabled, false)
  chatFailing = false; chatHolding = true
  let pendingChat
  await act(async () => { pendingChat = connectButton(view, '聊天模型').props.onClick(); await Promise.resolve() })
  assert.equal(connectButton(view, '聊天模型'), undefined)
  assert.equal(statusText(view, '聊天模型'), '连接中')
  chatHolding = false; releaseChat()
  await act(async () => pendingChat)
  assert.equal(statusText(view, '聊天模型'), '已连接')
  assert.equal(connectButton(view, '聊天模型'), undefined)
  assert.equal(calls.filter(call => call.url.includes('/tunnel-connect')).length, 3)
  assert.deepEqual(calls.filter(call => call.url.includes('/tunnel-connect')).at(-1).body, { id: 'qwen3.8-27b-elysium' })
  await act(async () => radio(view, '视频 B（私有）').props.onClick())
  assert.equal(data.selected.video, 'a')
  assert.equal(radio(view, '视频 B（私有）').props['aria-checked'], true)
  assert.equal(rowStatus(view, '视频 B（私有）'), '连接失败')
  assert.equal(rowConnect(view, '视频 B（私有）').children.join(''), '连接')
  failing = false
  holding = true
  let pending
  await act(async () => { pending = radio(view, '视频 B（私有）').props.onClick(); await Promise.resolve() })
  assert.equal(radio(view, '视频 B（私有）').props.disabled, true)
  assert.equal(rowStatus(view, '视频 B（私有）'), '连接中')
  holding = false; release()
  await act(async () => pending)
  assert.equal(data.selected.video, 'b')
  assert.equal(radio(view, '视频 B（私有）').props['aria-checked'], true)
  assert.equal(rowStatus(view, '视频 B（私有）'), '已连接')
  assert.equal(calls.filter(call => call.url.includes('/model-connect') && call.body.kind === 'video').length, 3)
  await act(async () => radio(view, 'Seedance 2.0（三方）').props.onClick())
  await flush()
  assert.equal(data.third_party_selected.video, 'byteplus:seedance2')
  assert.equal(radio(view, 'Seedance 2.0（三方）').props['aria-checked'], true)
  assert.equal(rowStatus(view, 'Seedance 2.0（三方）'), '已连接')
  assert.deepEqual(calls.filter(call => call.url.includes('/third-party-select')).at(-1).body, { kind: 'video', id: 'byteplus:seedance2', revision: 2 })
  await act(async () => view.unmount())
})

test('startup connects selected private models and only shows a connect button when disconnected', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'token', settingsBase: '/settings' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController,
    fetch: async (url, options) => {
      const body = options?.body && JSON.parse(options.body); calls.push({ url, body })
      if (url.includes('/tunnel-connect')) return { ok: true, json: async () => ({ connected: true }) }
      if (url.includes('/model-status')) return { ok: true, json: async () => ({ connected: true }) }
      if (url.includes('/model-connect')) return { ok: true, json: async () => ({ connected: true, revision: 1 }) }
      return { ok: true, json: async () => ({ revision: 0, models: { image: [{ id: 'image', label: 'RealVisXL' }], video: [{ id: 'video', label: 'MiniMax H3' }] }, selected: { image: 'image', video: 'video' }, origin: { image: 'own', video: 'own' }, chat_model: { id: 'qwen3.8-27b-elysium', label: 'qwen3.8' } }) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/settings').Settings)) })
  await flush()
  assert.equal(statusText(view, '聊天模型'), '已连接')
  assert.equal(statusText(view, '图片模型'), '已连接')
  assert.equal(statusText(view, '视频模型'), '已连接')
  assert.equal(connectButton(view, '聊天模型'), undefined)
  assert.equal(connectButton(view, '图片模型'), undefined)
  assert.equal(connectButton(view, '视频模型'), undefined)
  assert.equal(calls.filter(call => call.url.includes('/tunnel-connect')).length, 1)
  assert.equal(calls.filter(call => call.url.includes('/model-status')).length, 2)
  assert.equal(calls.filter(call => call.url.includes('/model-connect')).length, 0)
  await act(async () => view.unmount())
})

test('unselected private image and video default to the first private model and connect', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'token', settingsBase: '/settings' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController,
    fetch: async (url, options) => {
      const body = options?.body && JSON.parse(options.body); calls.push({ url, body })
      if (url.includes('/model-status')) return { ok: true, json: async () => ({ connected: false }) }
      if (url.includes('/model-connect')) return { ok: true, json: async () => ({ connected: true, revision: 1 }) }
      return { ok: true, json: async () => ({ revision: 0, models: { image: [{ id: 'image', label: 'RealVisXL' }], video: [{ id: 'video', label: 'MiniMax H3' }] }, selected: { image: '', video: '' },
        third_party: { video: [{ id: 'bailian:wan26', label: 'Wan 2.6' }] }, third_party_selected: { image: '', video: 'bailian:wan26' } }) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/settings').Settings)) })
  await flush()
  assert.equal(radio(view, 'RealVisXL（私有）').props['aria-checked'], true)
  assert.equal(radio(view, 'MiniMax H3（私有）').props['aria-checked'], true)
  assert.equal(radio(view, 'Wan 2.6（三方）').props['aria-checked'], false)
  assert.deepEqual(radios(view, '图片模型').map(item => item.props['aria-label']), ['RealVisXL（私有）'])
  assert.deepEqual(radios(view, '视频模型').map(item => item.props['aria-label']), ['MiniMax H3（私有）', 'Wan 2.6（三方）'])
  assert.deepEqual(calls.filter(call => call.url.includes('/model-connect')).map(call => call.body.id), ['image', 'video'])
  assert.equal(statusText(view, '图片模型'), '已连接')
  assert.equal(statusText(view, '视频模型'), '已连接')
  await act(async () => view.unmount())
})

test('startup keeps a third-party video selection and does not connect a private model', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'token', settingsBase: '/settings' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController,
    fetch: async (url, options) => {
      const body = options?.body && JSON.parse(options.body); calls.push({ url, body })
      if (url.includes('/tunnel-connect')) return { ok: true, json: async () => ({ connected: true }) }
      if (url.includes('/model-status')) return { ok: true, json: async () => ({ connected: true }) }
      if (url.includes('/model-connect')) return { ok: true, json: async () => ({ connected: true, revision: 1 }) }
      return { ok: true, json: async () => ({ revision: 2, models: { image: [{ id: 'image', label: 'RealVisXL' }], video: [{ id: 'video', label: 'MiniMax H3' }] }, selected: { image: 'image', video: '' }, origin: { image: 'own', video: 'third' }, chat_model: { id: 'qwen3.8-27b-elysium', label: 'qwen3.8' },
        third_party: { video: [{ id: 'bailian:wan26', label: 'Wan 2.6' }] }, third_party_selected: { image: '', video: 'bailian:wan26' } }) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/settings').Settings)) })
  await flush()
  assert.equal(radio(view, 'MiniMax H3（私有）').props['aria-checked'], false)
  assert.equal(radio(view, 'Wan 2.6（三方）').props['aria-checked'], true)
  assert.equal(rowStatus(view, 'Wan 2.6（三方）'), '')
  assert.equal(calls.filter(call => call.url.includes('/model-connect') && call.body.kind === 'video').length, 0)
  await act(async () => view.unmount())
})
