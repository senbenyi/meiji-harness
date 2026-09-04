import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { JSDOM } from 'jsdom'
import { createStudio } from '../../src/presentation/studio/views/videos/Studio.js'

function installDom() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3080/' })
  const previous = { window: globalThis.window, document: globalThis.document, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.HTMLElement.prototype.attachEvent = () => {}
  window.HTMLElement.prototype.detachEvent = () => {}
  return () => {
    dom.window.close()
    globalThis.window = previous.window
    globalThis.document = previous.document
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator)
    else delete globalThis.navigator
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
}

const director = { id: 'kokoro-realism', schoolName: '真实交流派', inspiredBy: '代代木忠', summary: '真实交流、心理引导、人物情绪', styleTags: ['真实交流'], disclaimer: '风格研究用途，未获得真实人士授权或背书。', skill: 'elysium-story' }

test('创新项目界面创建项目并接通 DeepSeek 创作会话', async () => {
  const restore = installDom()
  const { createRoot } = await import('react-dom/client')
  const { act, Simulate } = await import('react-dom/test-utils')
  const calls = []
  const projects = []
  const creation = { projectId: 'project-creative', conversationId: null, status: 'director_selected', currentStep: 1, steps: [], storyDraft: null }
  const api = {
    mediaUrl: () => '',
    async fetchJson(route, body = {}) {
      calls.push([route, body])
      if (route === '/project.list') return { projects }
      if (route === '/episode.list') return { episodes: [] }
      if (route === '/director.list') return { directors: [director] }
      if (route === '/creation.create_project') {
        const project = { id: 'project-creative', title: body.title, kind: 'creative', directorId: body.directorId }
        projects.push(project)
        return { project, creation: { ...creation }, director, openingPrompt: '导演开场', skill: 'elysium-story' }
      }
      if (route === '/creation.bind_session') {
        creation.conversationId = body.conversationId
        creation.status = body.skillLoaded ? 'skill_loaded' : 'conversation_created'
        return { creation: { ...creation }, director }
      }
      if (route === '/creation.get_state') return { project: projects[0], creation: { ...creation }, director, openingPrompt: '导演开场', skill: 'elysium-story' }
      throw new Error(`unexpected route: ${route}`)
    },
  }
  const sessionCalls = []
  const session = {
    async rename(value) { sessionCalls.push(['rename', value]) },
    async command(value) { sessionCalls.push(['command', value]) },
    async prompt(...value) { sessionCalls.push(['prompt', ...value]) },
  }
  const sidebar = { openTab: (...args) => sessionCalls.push(['openTab', ...args]) }
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ current: 'main', byId: { main: { cwd: '/workspace' } } }) },
      create: async ({ sessionId }) => sessionId,
      binding: id => ({ sessionId: id, session }),
      open: id => sessionCalls.push(['open', id]),
    },
    get: key => key === 'betterSidebar' ? sidebar : undefined,
  }
  const Studio = createStudio(React, api)
  const root = createRoot(document.getElementById('root'))
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
  const click = async element => act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)) })

  try {
    await act(async () => root.render(React.createElement(Studio, { ctx })))
    await settle()
    await click(button('创新项目'))
    await settle()
    assert.match(document.body.textContent, /创建创新项目/)
    await act(async () => Simulate.change(document.querySelector('.ely-creative-create input[type="text"]'), { target: { value: '雾港来信' } }))
    await click(button('创建并进入创作'))
    await settle(); await settle()
    assert.equal(calls.filter(([route]) => route === '/creation.create_project').length, 1)
    assert.equal(calls.filter(([route]) => route === '/creation.bind_session').length, 2)
    assert.deepEqual(sessionCalls.find(item => item[0] === 'command'), ['command', '/skill elysium-story'])
    assert.equal(sessionCalls.find(item => item[0] === 'prompt')[1][0].text, '导演开场')
    assert.equal(sessionCalls.find(item => item[0] === 'openTab')[1].meta.projectId, 'project-creative')
    assert.ok(sessionCalls.some(item => item[0] === 'open'))
  } finally {
    await act(async () => root.unmount())
    restore()
  }
})

test('结构化剧情只能由明确按钮确认并顺序写入制作流程', async () => {
  const restore = installDom()
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react-dom/test-utils')
  const project = { id: 'project-creative', title: '雾港来信', kind: 'creative', directorId: director.id }
  const compliance = { fictional_adults_only: true, all_participants_18_or_older: true, consensual_content: true, rights_confirmed: true }
  const creation = {
    projectId: project.id, conversationId: 'session-1', status: 'awaiting_story_approval', currentStep: 15,
    storyHash: 'sha256:story', storyVersion: 1, steps: Array.from({ length: 15 }, (_, index) => ({ index: index + 1, label: `步骤 ${index + 1}`, status: index < 14 ? 'confirmed' : 'draft' })),
    storyDraft: { logline: '雨夜重逢', synopsis: '两名旧识在码头重逢。', durationSec: 40, chapterCount: 2, characters: [{ name: '林岸', age: 29 }], scenes: [{ title: '码头' }], directorNotes: '克制', compliance },
  }
  const routeCalls = []
  const detail = { episode: { id: 'episode-1', projectId: project.id, title: '雾港来信', sourceText: '故事', targetDurationSec: 40, profile: 'preview' }, script: { scenes: [] }, plan: { source: 'producer-agent', chapters: [] }, tasks: [], issues: [], state: { status: 'ready', activeStage: 'story' } }
  const api = { mediaUrl: () => '', async fetchJson(route, body = {}) {
    routeCalls.push([route, body])
    if (route === '/project.list') return { projects: [project] }
    if (route === '/episode.list') return { episodes: [] }
    if (route === '/creation.get_state') return { project, creation, director, openingPrompt: '导演开场', skill: 'elysium-story' }
    if (route === '/creation.approve_story') { creation.approval = { storyHash: creation.storyHash }; creation.status = 'story_approved'; return { creation, director } }
    if (route === '/creation.sync_to_production') { creation.status = 'production_ready'; creation.sync = { episodeId: 'episode-1' }; return { creation, director, episodeId: 'episode-1' } }
    if (route === '/episode.get') return detail
    throw new Error(`unexpected route: ${route}`)
  } }
  const Studio = createStudio(React, api)
  const root = createRoot(document.getElementById('root'))
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  try {
    await act(async () => root.render(React.createElement(Studio, { initialProjectId: project.id })))
    await settle(); await settle()
    const confirm = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === '确认剧情并进入制作')
    assert.ok(confirm)
    await act(async () => { confirm.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
    await settle()
    const order = routeCalls.map(([route]) => route)
    assert.ok(order.indexOf('/creation.approve_story') < order.indexOf('/creation.sync_to_production'))
    assert.deepEqual(routeCalls.find(([route]) => route === '/creation.approve_story')[1].compliance, compliance)
    assert.match(document.body.textContent, /制作流程/)
  } finally {
    await act(async () => root.unmount())
    restore()
  }
})
