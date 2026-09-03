import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { JSDOM } from 'jsdom'
import { createStudio } from '../../src/presentation/studio/views/videos/Studio.js'

function episode(projectId, id = 'episode-1') {
  return {
    episode: { id, projectId, title: '第一集', sourceText: '原始故事', targetDurationSec: 10, aspectRatio: '9:16', profile: 'preview', stylePrompt: '', castPrompt: '' },
    script: { scenes: [] }, assets: [], plan: { source: 'draft', chapters: [] }, tasks: [], issues: [],
    state: { status: 'ready', activeStage: 'story', authorizedAt: null, final: null },
  }
}

test('studio protects edits and completes the guided production interaction flow', async () => {
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
  const projects = [{ id: 'project-1', title: '项目一' }, { id: 'project-2', title: '项目二' }]
  const details = new Map([['project-1', episode('project-1')]])
  const summaries = new Map([
    ['project-1', [{ ...details.get('project-1').episode, status: 'ready', activeStage: 'story', createdAt: '1' }]],
    ['project-2', []],
  ])
  const calls = []
  const api = {
    mediaUrl: (projectId, path) => `/file/${projectId}/${path}`,
    async fetchJson(route, body = {}) {
      calls.push([route, body])
      if (route === '/project.list') return { projects }
      if (route === '/episode.list') return { episodes: summaries.get(body.projectId) || [] }
      if (route === '/episode.get' || route === '/production.status') return structuredClone(details.get(body.projectId))
      if (route === '/episode.create') {
        const value = episode(body.projectId, body.episodeId)
        value.episode = { ...value.episode, ...body, id: body.episodeId }
        details.set(body.projectId, value)
        summaries.get(body.projectId).push({ ...value.episode, status: 'ready', activeStage: 'story', createdAt: '2' })
        return structuredClone(value)
      }
      if (route === '/episode.update') {
        const value = details.get(body.projectId); Object.assign(value.episode, body.updates); return structuredClone(value)
      }
      if (route === '/episode.plan') {
        const value = details.get(body.projectId)
        value.script = { synopsis: '已规划', scenes: [{ id: 'scene-1', title: '开场', summary: '场景摘要' }] }
        value.plan = { source: 'producer-agent', chapters: [{ id: 'chapter-1', title: '第一章', anchors: [{ id: 'anchor-1', imagePrompt: '起始画面' }] }] }
        return structuredClone(value)
      }
      if (route === '/production.start' || route === '/production.resume') {
        const value = details.get(body.projectId); value.state.status = 'running'; value.state.authorizedAt ||= 'now'; value.tasks = [{ id: 'task-1', type: 'start_frame', entityId: 'chapter-1', status: 'running' }]; return structuredClone(value)
      }
      if (route === '/production.pause') { const value = details.get(body.projectId); value.state.status = 'paused'; return structuredClone(value) }
      if (route === '/production.retry') { const value = details.get(body.projectId); value.state.status = 'running'; value.issues = []; return structuredClone(value) }
      if (route === '/review.approve') { const value = details.get(body.projectId); value.state.status = 'approved'; return structuredClone(value) }
      throw new Error(`unexpected route: ${route}`)
    },
  }

  const Studio = createStudio(React, api)
  const root = createRoot(document.getElementById('root'))
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const button = text => {
    const value = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text || item.textContent.includes(text))
    assert.ok(value, `missing button: ${text}`)
    return value
  }
  const click = async element => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
  const change = async (element, value) => act(async () => { Simulate.change(element, { target: { value } }) })

  try {
    await act(async () => root.render(React.createElement(Studio, { initialProjectId: 'project-1', initialEpisodeId: 'episode-1' })))
    await settle(); await settle()
    assert.equal(button('请先自动规划').disabled, true)

    await change(document.querySelector('.ely-story-input'), '尚未保存的新故事')
    assert.equal(button('自动规划').disabled, true)
    assert.equal(button('刷新状态').disabled, true)
    await click(button('项目二'))
    assert.match(document.body.textContent, /放弃未保存修改/)
    await click(button('继续编辑'))
    assert.match(document.body.textContent, /尚未保存的新故事/)
    await click(button('项目二'))
    await click(button('放弃并继续'))
    await settle(); await settle()

    await change(document.querySelector('input[placeholder*="雨夜来客"]'), '第二项目第一集')
    await change(document.querySelector('textarea[placeholder*="未来十秒"]'), '测试完整故事')
    await click(button('保存单集'))
    assert.equal(button('请先自动规划').disabled, true)
    await change(document.querySelector('.ely-story-input'), '保存后的新故事')
    await click(button('保存修改'))
    await click(button('自动规划'))
    assert.match(document.body.textContent, /已规划/)

    await click(document.querySelector('.ely-authorization input'))
    await click(button('开始自动生产'))
    assert.ok(button('暂停生产'))
    await click(button('暂停生产'))
    assert.ok(button('继续生产'))
    await click(button('继续生产'))

    const current = details.get('project-2')
    current.state.status = 'needs_attention'
    current.issues = [{ id: 'issue-1', status: 'open', taskId: 'task-1', code: 'FAILED', message: '模拟失败' }]
    await click(button('刷新状态'))
    await click(button('重试'))

    current.state.status = 'awaiting_review'
    current.state.final = { path: 'final.mp4', qc: { durationSec: 10 } }
    current.tasks = [{ id: 'final-1', type: 'final', entityId: 'episode', status: 'succeeded', path: 'final.mp4' }]
    await click(button('刷新状态'))
    await click(button('前往终审'))
    const reviewCheck = document.querySelector('.ely-check input')
    assert.equal(reviewCheck.disabled, true)
    await act(async () => { Simulate.ended(document.querySelector('.ely-final-player video')) })
    assert.equal(reviewCheck.disabled, false)
    await change(document.querySelector('input[placeholder="输入审核人标识"]'), ' reviewer ')
    await click(reviewCheck)
    await click(button('通过终审'))
    assert.equal(calls.findLast(([route]) => route === '/review.approve')[1].reviewer, 'reviewer')
    assert.ok(document.querySelector('a[download$=".mp4"]'))
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
