import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { JSDOM } from 'jsdom'
import { createElysiumApp } from '../../src/presentation/studio/ElysiumApp.js'

test('top navigation protects unsaved settings and keeps tab metadata in sync', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3080/' })
  const previous = { window: globalThis.window, document: globalThis.document, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.HTMLElement.prototype.attachEvent = () => {}
  window.HTMLElement.prototype.detachEvent = () => {}
  const { createRoot } = await import('react-dom/client')
  const { act, Simulate } = await import('react-dom/test-utils')
  const updates = []
  let resolveSettingsState
  const settingsState = new Promise(resolve => { resolveSettingsState = resolve })
  const loadedSettingsState = { baseUrl: 'http://127.0.0.1:8189', ping: { ok: true }, templates: [], loras: [], availableLoras: [] }
  const api = {
    mediaUrl: () => '',
    async fetchJson(route) {
      if (route === '/comfyui.state') return settingsState
      if (route === '/project.list') return { projects: [] }
      throw new Error(`unexpected route: ${route}`)
    },
  }
  const ctx = { get: () => ({ updateTab: (_id, value) => updates.push(value) }) }
  const App = createElysiumApp(React, api)
  const root = createRoot(document.getElementById('root'))
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const click = async element => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)

  try {
    await act(async () => root.render(React.createElement(App, { ctx, tab: { id: 'elysium', meta: { view: 'comfyui' } } })))
    await settle()
    assert.equal(button('制作').disabled, false)
    assert.equal(button('模型设置').disabled, false)
    assert.equal(document.querySelector('input[aria-label="ComfyUI 服务地址"]').disabled, false)
    await act(async () => { resolveSettingsState(loadedSettingsState); await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => { Simulate.change(document.querySelector('input[aria-label="ComfyUI 服务地址"]'), { target: { value: 'http://draft:8188' } }) })
    await click(button('制作'))
    assert.match(document.body.textContent, /模型设置还有未保存修改/)
    await act(async () => { document.querySelector('.tf-modal').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    assert.ok(document.querySelector('.tf-comfy'))
    await click(button('制作'))
    await click(button('继续编辑'))
    assert.ok(document.querySelector('.tf-comfy'))
    await click(button('制作'))
    await click(button('放弃并离开'))
    await settle()
    assert.match(document.body.textContent, /短剧总览/)
    assert.equal(updates.at(-1).meta.view, 'studio')
    await click(button('模型设置'))
    await settle()
    assert.ok(document.querySelector('.tf-comfy'))
    assert.equal(updates.at(-1).meta.view, 'comfyui')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    globalThis.window = previous.window
    globalThis.document = previous.document
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator)
    else delete globalThis.navigator
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
