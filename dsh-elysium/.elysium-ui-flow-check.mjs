import assert from 'node:assert/strict'
import React from 'react'
import { JSDOM } from 'jsdom'
import { createElysiumApp } from './src/presentation/studio/ElysiumApp.js'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3080/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
window.HTMLElement.prototype.attachEvent = () => {}
window.HTMLElement.prototype.detachEvent = () => {}

const { createRoot } = await import('react-dom/client')
const { act, Simulate } = await import('react-dom/test-utils')

const calls = []
const projects = []
const episodes = new Map()
let detail = null
let comfy = {
  baseUrl: 'http://127.0.0.1:8189', ping: { ok: false }, availableLoras: ['cinema.safetensors'], loras: [],
  templates: [{ id: 'story', title: '故事图', capabilities: { mode: ['image'] }, user_note: '' }],
}

const api = {
  mediaUrl: (projectId, path) => `/elysium/file?project=${projectId}&path=${path}`,
  async fetchJson(route, body = {}) {
    calls.push([route, body])
    if (route === '/project.list') return { projects: [...projects] }
    if (route === '/project.create') {
      const project = { id: 'project-1', title: body.title }
      projects.push(project); episodes.set(project.id, []); return { project }
    }
    if (route === '/project.delete') {
      projects.splice(projects.findIndex(item => item.id === body.projectId), 1); return { ok: true }
    }
    if (route === '/episode.list') return { episodes: [...(episodes.get(body.projectId) || [])] }
    if (route === '/episode.create') {
      detail = {
        episode: { ...body, id: body.episodeId }, script: { scenes: [] }, assets: [],
        plan: { source: 'draft', chapters: [] }, tasks: [], issues: [],
        state: { status: 'ready', activeStage: 'story', authorizedAt: null, final: null },
      }
      episodes.get(body.projectId).push({ ...detail.episode, status: 'ready', activeStage: 'story', createdAt: '2026-09-03' })
      return structuredClone(detail)
    }
    if (route === '/episode.get') return structuredClone(detail)
    if (route === '/episode.update') { Object.assign(detail.episode, body.updates); return structuredClone(detail) }
    if (route === '/episode.plan') {
      detail.script = { synopsis: '测试梗概', scenes: [{ id: 'scene-1', title: '开场', summary: '建立人物与冲突' }] }
      detail.plan = { source: 'producer-agent', chapters: [{ id: 'chapter-1', title: '第一章', anchors: [{ id: 'anchor-1', imagePrompt: '雨夜街道' }] }] }
      detail.state.activeStage = 'script'; return structuredClone(detail)
    }
    if (route === '/production.start' || route === '/production.resume') {
      detail.state.status = 'running'; detail.state.authorizedAt ||= '2026-09-03T00:00:00Z'; detail.state.activeStage = 'start_frame'
      detail.tasks = [{ id: 'start:1', type: 'start_frame', entityId: 'chapter-1', status: 'running' }]
      return structuredClone(detail)
    }
    if (route === '/production.pause') { detail.state.status = 'paused'; return structuredClone(detail) }
    if (route === '/production.status') return structuredClone(detail)
    if (route === '/production.retry') { detail.issues = []; detail.state.status = 'running'; return structuredClone(detail) }
    if (route === '/review.approve') { detail.state.status = 'approved'; return structuredClone(detail) }
    if (route === '/comfyui.state') return structuredClone(comfy)
    if (route === '/comfyui.save') {
      comfy = { ...comfy, baseUrl: body.baseUrl, ping: { ok: true, device: 'RTX 4090' }, loras: Object.entries(body.loras || {}).map(([name, value]) => ({ name, ...value, on_server: true })) }
      return structuredClone(comfy)
    }
    if (route === '/comfyui.scan') return { draft: { id: body.id || 'imported', title: body.title || '导入工作流' } }
    if (route === '/comfyui.import') { comfy.templates.push({ id: body.id || 'imported', title: body.title || '导入工作流', capabilities: { mode: [] } }); return structuredClone(comfy) }
    if (route === '/comfyui.remove_template') { comfy.templates = comfy.templates.filter(item => item.id !== body.id); return structuredClone(comfy) }
    if (route === '/comfyui.remove_lora') { comfy.loras = comfy.loras.filter(item => item.name !== body.name); return structuredClone(comfy) }
    throw new Error(`Unexpected route ${route}`)
  },
}

const App = createElysiumApp(React, api)
const root = createRoot(document.getElementById('root'))
const flush = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const buttons = () => [...document.querySelectorAll('button')]
const button = text => {
  const found = buttons().find(item => item.textContent.trim() === text || item.textContent.includes(text))
  assert.ok(found, `button not found: ${text}; body=${document.body.textContent.slice(0, 500)}; calls=${JSON.stringify(calls)}`); return found
}
const click = async element => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)) }); await flush() }
const setValue = async (element, value) => {
  assert.ok(element, 'input not found')
  await act(async () => { Simulate.change(element, { target: { value } }) })
}

await act(async () => root.render(React.createElement(App, { ctx: { get: () => ({ updateTab() {} }) }, tab: { id: 'elysium', meta: {} } })))
await flush(); await flush()

await click(button('新建项目'))
await setValue(document.querySelector('input[placeholder="项目名称"]'), '交互验收项目')
await click(button('创建'))
await setValue(document.querySelector('input[placeholder*="雨夜来客"]'), '第一集')
await setValue(document.querySelector('textarea[placeholder*="未来十秒"]'), '一个完整的测试故事')
await click(button('保存'))

for (const stage of ['故事', '剧本', '资产', '规划', '起始帧', '关键帧', '章节', '成片']) await click(button(stage))
await click(button('故事'))
await click(button('自动规划'))
assert.match(document.body.textContent, /测试梗概/)

await click(document.querySelector('.ely-authorization input'))
await click(button('开始自动生产'))
assert.ok(button('暂停生产'))
await click(button('暂停生产'))
assert.ok(button('继续生产'))
await click(button('继续生产'))
await click(button('刷新状态'))

detail.state.status = 'needs_attention'
detail.issues = [{ id: 'issue-1', status: 'open', taskId: 'start:1', code: 'GENERATION_FAILED', message: '模拟失败' }]
await click(button('刷新状态'))
await click(button('重试'))

detail.state.status = 'awaiting_review'
detail.state.activeStage = 'final'
detail.state.final = { path: 'final.mp4', qc: { durationSec: 10 } }
detail.tasks = [{ id: 'final:1', type: 'final', entityId: 'episode', status: 'succeeded', path: 'final.mp4' }]
await click(button('刷新状态'))
await click(button('前往终审'))
await setValue(document.querySelector('input[placeholder="输入审核人标识"]'), 'reviewer')
await click(document.querySelector('.ely-check input'))
await click(button('通过终审'))
assert.ok(button('查看成片'))

await click(button('设置')); await flush()
await click(button('测试'))
await click(button('↻'))
await click([...document.querySelectorAll('summary')].find(item => item.textContent.includes('工作流')))
await click(button('保存注释'))
await click([...document.querySelectorAll('summary')].find(item => item.textContent.includes('导入工作流')))
await setValue(document.querySelector('input[placeholder*="API Format"]'), '/tmp/workflow.json')
await click(button('扫描'))
await click(button('导入'))
await click([...document.querySelectorAll('summary')].find(item => item.textContent.startsWith('LoRA')))
await setValue(document.querySelector('.tf-comfy-filter'), 'cinema')
await click(button('添加'))
await click(button('保存 LoRA'))
await click(button('删除 LoRA'))

await click(button('制作')); await flush()
await click(button('删除项目'))
await click(button('取消'))
await click(button('删除项目'))
await click(button('确认删除'))

for (const route of ['/project.create', '/episode.create', '/episode.plan', '/production.start', '/production.pause', '/production.resume', '/production.retry', '/review.approve', '/comfyui.scan', '/comfyui.import', '/project.delete']) {
  assert.ok(calls.some(([called]) => called === route), `route not called: ${route}`)
}
console.log(JSON.stringify({ ok: true, calls: calls.length, routes: [...new Set(calls.map(([route]) => route))] }))
await act(async () => root.unmount())
