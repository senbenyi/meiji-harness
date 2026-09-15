// 职责：验证固定模型下拉列表、被动状态检查、连接失败和独立目标切换。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

test('model panel leaves images empty, preserves active targets on failure and connects selected models', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  const data = { revision: 1, models: { llm: [{ id: 'qwen', label: 'Qwen' }], analysis: [{ id: 'qwen', label: 'Qwen3.8 27B' }], image: [], video: [{ id: 'a', label: '视频 A' }, { id: 'b', label: '视频 B' }] }, selected: { llm: 'qwen', analysis: 'qwen', image: '', video: 'a' }, pending_llm: false }
  let failing = true
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'token', serverBase: '/prefix/server' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController,
    fetch: async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      calls.push({ url, body }); assert.match(url, /^\/prefix\/server\/.+\?t=token$/)
      if (url.includes('/model-status')) return { ok: true, json: async () => ({ connected: body.kind === 'video' }) }
      if (url.includes('/model-connect')) {
        if (failing) return { ok: false, json: async () => ({ error: '模型检查失败' }) }
        data.selected[body.kind] = body.id; data.revision++
        if (body.kind === 'llm') data.pending_llm = true
        return { ok: true, json: async () => ({ connected: true, revision: data.revision, pending: body.kind === 'llm' }) }
      }
      return { ok: true, json: async () => structuredClone(data) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/servers').ServerList)) })
  assert.equal(view.root.findAllByType('select').length, 4)
  const image = view.root.findByProps({ 'aria-label': '图片模型' })
  assert.equal(image.props.disabled, true)
  assert.deepEqual(image.findAllByType('option').map(option => option.children.join('')), [''])
  assert.equal(view.root.findAllByProps({ 'aria-label': '连接视频模型' }).length, 0)
  assert.equal(view.root.findByProps({ 'aria-label': '重新连接视频模型' }).children.join(''), '重新连接')
  assert.equal(view.root.findAllByProps({ 'aria-label': '连接文本模型' }).length, 1)
  assert.ok(view.root.findAllByProps({ className: 'elysium-model-row' }).every(row => row.findAllByProps({ role: 'status' }).length === 0))
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /手工登记|添加视频|添加聊天|未接入|刷新列表/)
  assert.equal(calls.filter(call => call.url.includes('/model-connect')).length, 0)
  const initialCalls = calls.length
  await act(async () => view.root.findByProps({ 'aria-label': '视频模型' }).props.onChange({ target: { value: 'b' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '连接视频模型' }).props.onClick())
  assert.equal(data.selected.video, 'a')
  assert.equal(view.root.findByProps({ 'aria-label': '视频模型' }).props.value, 'b')
  assert.match(JSON.stringify(view.toJSON()), /模型检查失败/)
  failing = false
  await act(async () => view.root.findByProps({ 'aria-label': '连接视频模型' }).props.onClick())
  assert.equal(data.selected.video, 'b')
  assert.equal(data.selected.llm, 'qwen')
  assert.equal(view.root.findAllByProps({ 'aria-label': '连接视频模型' }).length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '重新连接视频模型' }).props.onClick())
  assert.equal(calls.filter(call => call.url.includes('/model-connect') && call.body.kind === 'video').length, 3)
  await act(async () => view.root.findByProps({ 'aria-label': '连接文本模型' }).props.onClick())
  assert.match(JSON.stringify(view.toJSON()), /待重启生效/)
  await act(async () => view.root.findByProps({ 'aria-label': '连接分析模型' }).props.onClick())
  assert.equal(data.selected.analysis, 'qwen')
  assert.equal(view.root.findByProps({ 'aria-label': '重新连接分析模型' }).children.join(''), '重新连接')
  assert.ok(calls.slice(initialCalls).every(call => call.url.includes('/model-connect')))
  assert.deepEqual(calls.slice(initialCalls).map(call => call.body.revision), [1, 1, 2, 3, 4])
  await act(async () => view.unmount())
})
