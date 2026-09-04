import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { JSDOM } from 'jsdom'
import { createComfyUiSettings } from '../../src/presentation/studio/views/setting/Settings.js'

function initialState() {
  return {
    baseUrl: 'http://127.0.0.1:8189',
    ping: { ok: true, device: 'GPU', version: '1.0' },
    templates: [
      { id: 'builtin', title: '内置工作流', removable: false, user_note: '', capabilities: { mode: ['image'] } },
      { id: 'custom', title: '自定义工作流', removable: true, user_note: '原注释', capabilities: { mode: ['video'] } },
      { id: 'mmaudio', title: '同步音效', removable: false, user_note: '', capabilities: { mode: ['video_audio', 'audio'] } },
    ],
    loras: [{ name: 'saved.safetensors', triggerWords: 'saved', mode: 'both', note: '', usedBy: [], on_server: true, in_registry: true }],
    availableLoras: ['saved.safetensors', 'new.safetensors'],
    modelRouting: {
      planner: { provider: 'qwen38-local', model: 'qwen3.8-27b-video-prompt', maxTokens: 4096 },
      stages: {
        characterImage: 'builtin', startFrame: 'builtin', keyframeImage: 'builtin',
        chapterVideo: 'custom', finalAudio: 'mmaudio', shotImage: 'builtin', shotVideo: 'custom',
      },
    },
    textProviders: [
      { id: 'qwen38-local', name: 'Qwen Local', models: [{ id: 'qwen3.8-27b-video-prompt', name: 'Qwen 3.8' }] },
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }, { id: 'gpt-5.5', name: 'GPT-5.5' }] },
    ],
  }
}

test('settings buttons distinguish testing, drafts, saving, deleting and repeated clicks', async () => {
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
  let state = initialState()
  const calls = []
  const workflowResolvers = []
  let resolveConnectionTest
  const dirtyStates = []
  const api = {
    async fetchJson(route, body = {}) {
      calls.push([route, structuredClone(body)])
      if (route === '/comfyui.state') return structuredClone(state)
      if (route === '/comfyui.test') return new Promise(resolve => { resolveConnectionTest = () => resolve({ ok: true, baseUrl: body.baseUrl.replace(/\/$/, ''), ping: { ok: true, device: 'GPU' } }) })
      if (route === '/comfyui.save') {
        if (body.baseUrl) state.baseUrl = body.baseUrl.replace(/\/$/, '')
        if (body.templates) state.templates = state.templates.map(item => ({ ...item, user_note: body.templates[item.id]?.note || '' }))
        if (body.loras) state.loras = Object.entries(body.loras).map(([name, value]) => ({ name, ...value, usedBy: [], on_server: true, in_registry: true }))
        if (body.modelRouting) state.modelRouting = structuredClone(body.modelRouting)
        return structuredClone(state)
      }
      if (route === '/comfyui.test_template') return new Promise(resolve => workflowResolvers.push({ id: body.template, resolve }))
      if (route === '/comfyui.scan') return { draft: { id: body.id || 'imported', title: body.title || '导入工作流', nodes: 6 } }
      if (route === '/comfyui.import') {
        state.templates.push({ id: body.id || 'imported', title: body.title || '导入工作流', removable: true, user_note: '', capabilities: { mode: ['image'] } })
        return { ...structuredClone(state), id: body.id || 'imported' }
      }
      if (route === '/comfyui.remove_template') { state.templates = state.templates.filter(item => item.id !== body.id); return structuredClone(state) }
      if (route === '/comfyui.remove_lora') { state.loras = state.loras.filter(item => item.name !== body.name); return structuredClone(state) }
      throw new Error(`unexpected route: ${route}`)
    },
  }
  const Settings = createComfyUiSettings(React, api)
  const root = createRoot(document.getElementById('root'))
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const buttons = text => [...document.querySelectorAll('button')].filter(item => item.textContent.trim() === text)
  const button = text => {
    const value = buttons(text)[0]
    assert.ok(value, `missing button: ${text}; available: ${[...document.querySelectorAll('button')].map(item => item.textContent.trim()).join(' | ')}`)
    return value
  }
  const click = async element => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
  const doubleClick = async element => act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  const change = async (element, value) => act(async () => { Simulate.change(element, { target: { value } }) })

  try {
    await act(async () => root.render(React.createElement(Settings, { onDirty: value => dirtyStates.push(value) })))
    await settle()
    assert.equal(document.querySelector('.tf-settings-card small').textContent, '已连接')
    assert.equal(document.querySelector('button[aria-label="刷新服务器状态"]'), null)
    assert.doesNotMatch(document.body.textContent, /未发现供应商|可保留自定义路由/)
    const sectionSummaries = [...document.querySelectorAll('.tf-settings-section > summary')]
    assert.equal(sectionSummaries.find(item => item.textContent.includes('工作流')).parentElement.open, false)
    assert.equal(sectionSummaries.find(item => item.textContent.includes('LoRA')).parentElement.open, false)

    const baseInput = document.querySelector('input[aria-label="ComfyUI 服务地址"]')
    const baseSave = document.querySelector('.tf-settings-card .tf-btn:not(.tf-btn-ghost)')
    const baseTest = document.querySelector('.tf-settings-card .tf-btn-ghost')
    await change(baseInput, 'http://gpu.example:8188/')
    assert.equal(baseSave.disabled, false)
    assert.equal(document.querySelector('.tf-settings-card small').textContent, '未连接')
    await doubleClick(baseTest)
    assert.equal(calls.filter(([route]) => route === '/comfyui.test').length, 1)
    assert.equal(baseTest.disabled, true)
    assert.equal(baseSave.disabled, false)
    assert.equal(document.querySelector('.tf-model-routing select').disabled, false)
    assert.equal(document.querySelector('.tf-comfy-add input').disabled, false)
    await act(async () => { resolveConnectionTest(); await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.equal(document.querySelector('.tf-settings-card small').textContent, '已连接')
    assert.doesNotMatch(document.body.textContent, /连接成功.*当前保存地址未改变|地址尚未保存/)
    await click(baseSave)
    assert.equal(state.baseUrl, 'http://gpu.example:8188')
    assert.doesNotMatch(document.body.textContent, /ComfyUI 地址已保存并连接成功|地址已保存，但连接失败/)

    const modelSelects = [...document.querySelectorAll('.tf-model-routing select')]
    await change(modelSelects[0], 'openai')
    assert.equal(modelSelects[1].value, 'gpt-5.4')
    await change(modelSelects[1], 'gpt-5.5')
    await click(button('保存模型'))
    assert.deepEqual(state.modelRouting.planner, { provider: 'openai', model: 'gpt-5.5', maxTokens: 4096 })

    const customRow = [...document.querySelectorAll('.tf-workflow-row')].find(item => item.textContent.includes('自定义工作流'))
    await click(customRow.querySelector('.tf-workflow-toggle'))
    const note = document.querySelector('.tf-workflow-body textarea')
    await change(note, '新注释')
    assert.equal(button('保存注释').disabled, false)
    await click(buttons('撤销')[1])
    assert.equal(note.value, '原注释')
    await change(note, '已保存注释')
    await click(button('保存注释'))
    assert.equal(state.templates.find(item => item.id === 'custom').user_note, '已保存注释')
    const builtinRow = [...document.querySelectorAll('.tf-workflow-row')].find(item => item.textContent.includes('内置工作流'))
    const builtinTest = builtinRow.querySelector('.tf-workflow-actions .tf-btn')
    const customTest = customRow.querySelector('.tf-workflow-actions .tf-btn')
    await click(builtinTest)
    assert.equal(builtinTest.disabled, true)
    assert.equal(customTest.disabled, false)
    await click(customTest)
    assert.equal(customTest.disabled, true)
    await click(builtinTest)
    assert.equal(calls.filter(([route]) => route === '/comfyui.test_template').length, 2)
    await act(async () => {
      workflowResolvers.find(item => item.id === 'builtin').resolve({ ready: true, checked_nodes: 2, errors: [] })
      workflowResolvers.find(item => item.id === 'custom').resolve({ ready: false, checked_nodes: 3, errors: [{ code: 'MODEL_MISSING', name: 'missing.safetensors' }] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    assert.equal(builtinTest.disabled, false)
    assert.equal(customTest.disabled, false)
    assert.match(document.body.textContent, /缺少模型：missing\.safetensors/)

    await click(button('删除'))
    assert.match(document.body.textContent, /将永久删除/)
    await click(button('取消'))
    assert.ok(state.templates.some(item => item.id === 'custom'))
    await click(button('删除'))
    await click(button('确认删除'))
    assert.ok(!state.templates.some(item => item.id === 'custom'))

    const advanced = [...document.querySelectorAll('summary')].find(item => item.textContent.includes('导入 API 工作流'))
    advanced.parentElement.open = true
    const pathInput = [...document.querySelectorAll('.tf-settings-advanced input')][0]
    await change(pathInput, '/tmp/workflow.json')
    await click(button('扫描'))
    assert.equal(button('确认导入').disabled, false)
    const titleInput = [...document.querySelectorAll('.tf-settings-advanced input')][2]
    await change(titleInput, '变更名称')
    assert.equal(button('确认导入').disabled, true)
    assert.match(document.body.textContent, /请重新扫描/)
    await click(button('扫描'))
    await click(button('确认导入'))
    assert.ok(state.templates.some(item => item.title === '变更名称'))

    const loraSummary = [...document.querySelectorAll('.tf-settings-item > summary')].find(item => item.textContent.includes('saved.safetensors'))
    loraSummary.parentElement.open = true
    const triggerInput = loraSummary.parentElement.querySelector('input')
    await change(triggerInput, 'changed')
    assert.equal(button('保存 LoRA').disabled, false)
    await click(buttons('撤销').at(-1))
    assert.equal(triggerInput.value, 'saved')
    await change(document.querySelector('input[aria-label="筛选远程 LoRA"]'), 'new')
    await click(button('添加'))
    await click(button('保存 LoRA'))
    assert.ok(state.loras.some(item => item.name === 'new.safetensors'))

    const savedSummary = [...document.querySelectorAll('.tf-settings-item > summary')].find(item => item.textContent.includes('saved.safetensors'))
    savedSummary.parentElement.open = true
    await click(savedSummary.parentElement.querySelector('.tf-link-danger'))
    await click(button('取消'))
    assert.ok(state.loras.some(item => item.name === 'saved.safetensors'))
    await click(savedSummary.parentElement.querySelector('.tf-link-danger'))
    await click(button('确认删除'))
    assert.ok(!state.loras.some(item => item.name === 'saved.safetensors'))
    assert.ok(dirtyStates.includes(true) && dirtyStates.at(-1) === false)
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
