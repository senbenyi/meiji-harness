// 职责：验证模型面板只按类别提供下拉选择，并在切换失败时恢复原选择。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

test('model panel contains only categorized selectors and switches selected models', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  const data = { revision: 1, models: { image: [], video: [{ id: 'a', label: '视频 A' }, { id: 'b', label: '视频 B' }] }, selected: { image: '', video: 'a' },
    third_party: { video: [{ id: 'bailian:wan26', label: 'Wan 2.6' }, { id: 'byteplus:seedance2', label: 'Seedance 2.0' }] }, third_party_selected: { image: '', video: 'bailian:wan26' },
    third_party_channels: [{ id: 'bailian', label: '百炼万相', enabled: true, preferred: true, models: ['wan2.6-t2v', 'wan2.6-i2v'] }, { id: 'byteplus', label: 'Seedance 2.0', enabled: true, preferred: false, models: ['seedance'] }] }
  let failing = true, holding = false, release
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'token', serverBase: '/prefix/server' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController,
    fetch: async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      calls.push({ url, body }); assert.match(url, /^\/prefix\/server\/.+\?t=token$/)
      if (url.includes('/model-connect')) {
        if (failing) return { ok: false, json: async () => ({ error: '模型检查失败' }) }
        if (holding) await new Promise(resolve => { release = resolve })
        data.selected[body.kind] = body.id; data.revision++
        return { ok: true, json: async () => ({ connected: true, revision: data.revision }) }
      }
      if (url.includes('/third-party-select')) {
        data.third_party_selected[body.kind] = body.id; data.revision++
        return { ok: true, json: async () => ({ revision: data.revision, selected: body.id }) }
      }
      return { ok: true, json: async () => structuredClone(data) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/servers').ServerList)) })
  assert.equal(view.root.findAllByType('select').length, 4)
  assert.equal(view.root.findByProps({ 'aria-label': '模型设置' }).findAllByType('button').length, 0)
  assert.deepEqual(view.root.findByProps({ 'aria-label': '三方图片模型' }).findAllByType('option').map(option => option.children.join('')), ['未配置'])
  assert.deepEqual(view.root.findByProps({ 'aria-label': '三方视频模型' }).findAllByType('option').map(option => option.children.join('')), ['Wan 2.6', 'Seedance 2.0'])
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /已启用|已关闭|三方视频首选|wan2\.6-t2v|wan2\.6-i2v/)
  const image = view.root.findByProps({ 'aria-label': '图片模型' })
  assert.equal(image.props.disabled, true)
  assert.deepEqual(image.findAllByType('option').map(option => option.children.join('')), ['未配置'])
  assert.ok(view.root.findAllByProps({ className: 'elysium-model-row' }).every(row => row.findAllByProps({ role: 'status' }).length === 0))
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /手工登记|添加视频|添加聊天|未接入|刷新列表/)
  assert.equal(calls.filter(call => call.url.includes('/model-connect')).length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '视频模型' }).props.onChange({ target: { value: 'b' } }))
  assert.equal(data.selected.video, 'a')
  assert.equal(view.root.findByProps({ 'aria-label': '视频模型' }).props.value, 'a')
  assert.match(JSON.stringify(view.toJSON()), /模型检查失败/)
  failing = false
  holding = true
  let pending
  await act(async () => { pending = view.root.findByProps({ 'aria-label': '视频模型' }).props.onChange({ target: { value: 'b' } }); await Promise.resolve() })
  assert.equal(view.root.findByProps({ 'aria-label': '视频模型' }).props.disabled, true)
  assert.equal(view.root.findByProps({ 'aria-label': '图片模型' }).props.disabled, true)
  assert.equal(view.root.findByProps({ 'aria-label': '三方视频模型' }).props.disabled, false)
  holding = false; release()
  await act(async () => pending)
  assert.equal(data.selected.video, 'b')
  assert.equal(view.root.findByProps({ 'aria-label': '视频模型' }).props.value, 'b')
  assert.equal(calls.filter(call => call.url.includes('/model-connect') && call.body.kind === 'video').length, 2)
  await act(async () => view.root.findByProps({ 'aria-label': '三方视频模型' }).props.onChange({ target: { value: 'byteplus:seedance2' } }))
  assert.equal(data.third_party_selected.video, 'byteplus:seedance2')
  assert.deepEqual(calls.at(-1).body, { kind: 'video', id: 'byteplus:seedance2', revision: 2 })
  await act(async () => view.unmount())
})
