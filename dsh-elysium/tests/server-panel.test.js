// 职责：验证服务器设置的真实模块拼接、失败状态与切换回执。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'
test('server UI preserves selection on failed switch, renders receipt and prevents selecting disabled targets', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  const data = { revision: 1, active: { comfyui: 'a' }, current_llm: 'text-a', pending_llm: 'text-b', servers: ['a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase(), provider: 'manual', disabled: id === 'c', services: [{ kind: 'comfyui', transport: 'http' }] })) }
  let failing = true
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'token', serverBase: '/prefix/server' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController,
    fetch: async (url, options) => {
      calls.push(url); assert.match(url, /^\/prefix\/server\/.+\?t=token$/)
      if (url.includes('/switch')) {
        assert.equal(JSON.parse(options.body).id, 'b')
        if (failing) return { ok: false, json: async () => ({ error: '模型检查失败' }) }
        data.active.comfyui = 'b'; data.revision++
        return { ok: true, json: async () => ({ message: '新任务使用 B；旧任务继续 A。' }) }
      }
      return { ok: true, json: async () => structuredClone(data) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/servers').ServerList)) })
  const button = label => view.root.findAllByType('button').find(node => node.children.join('') === label)
  assert.equal(button('使用 C 视频生成').props.disabled, true)
  assert.match(JSON.stringify(view.toJSON()), /下次启动：text-b/)
  await act(async () => button('使用 B 视频生成').props.onClick())
  assert.equal(data.active.comfyui, 'a'); assert.equal(button('使用 A 视频生成').props.disabled, true)
  assert.match(JSON.stringify(view.toJSON()), /模型检查失败/)
  failing = false
  await act(async () => button('使用 B 视频生成').props.onClick())
  assert.equal(button('使用 B 视频生成').props.disabled, true)
  assert.match(JSON.stringify(view.toJSON()), /新任务使用 B；旧任务继续 A/)
  assert.ok(calls.length >= 4)
  await act(async () => view.unmount())
})
