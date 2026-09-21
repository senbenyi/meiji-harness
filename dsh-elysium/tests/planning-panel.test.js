// 职责：验证工作台五步导航、批量时间线与镜头采用门禁。
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

const entry = (value, finalized = 1, needs_review = false) => ({ versions: [{ version: 1, value }], finalized, needs_review })
const series = { episode_count: 3, episode_seconds: 10, characters: [{ id: 'lin' }], scenes: [{ id: 'room' }],
  episodes: [1, 2, 3].map(number => ({ number, title: `第 ${number} 集`, summary: '雨夜', hook: '门外有人' })) }
const project = () => ({ id: '1234abcd', title: '雨夜', director: 'director-a', genre: '悬疑', synopsis: '一封信', anchors: [
  { role: 'lin', kind: 'character', label: '林', description: '灰外套', source: { type: 'job', job_id: 'a'.repeat(32) }, image_url: '' },
  { role: 'scene-room', kind: 'scene', label: '公寓', description: '雨夜', source: null, image_url: '' }], acts: [], deliverables: [] })

function fixture({ value = project(), plan = { series: entry(series), episodes: {} }, failEpisode = 0 } = {}) {
  let current = structuredClone(value), planning = structuredClone(plan)
  const calls = [], modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { AbortController, setTimeout, clearTimeout, URLSearchParams, URL,
    window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' },
      __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, document: {},
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, body })
      if (url.startsWith('/director/list')) return { ok: true, json: async () => [] }
      if (url.startsWith('/project/plan-read')) return { ok: true, json: async () => structuredClone(planning) }
      if (url.startsWith('/project/get') || url.startsWith('/project/episode')) return { ok: true, json: async () => structuredClone(current) }
      if (url.startsWith('/project/plan-generate')) {
        if (body.episode === failEpisode) return { ok: false, json: async () => ({ error: '模型失败' }) }
        const item = planning.episodes[body.episode] ||= {}
        item.timeline = { versions: [{ version: 1, value: { beats: [] } }], finalized: null }
        return { ok: true, json: async () => structuredClone(planning) }
      }
      if (url.startsWith('/project/update-shot') && body.action === 'accept') current.acts[0].shots[0].accepted = body.data.accepted
      if (url.startsWith('/project/anchor-generate')) return { ok: true, json: async () => ({ tasks: [{ task_id: 'b'.repeat(32) }] }) }
      if (url.startsWith('/project/compose')) return { ok: true, json: async () => structuredClone(current) }
      if (url.startsWith('/media/status')) return { ok: true, json: async () => ({ has_image: true, has_video: true }) }
      return { ok: true, json: async () => structuredClone(current) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, calls, project: () => current, planning: () => planning }
}

test('project navigation has five steps and the project page contains only the project form', async () => {
  const f = fixture(), id = f.project().id
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id, viewState: { projectTab: 'project' }, back() {} })) })
  assert.deepEqual(view.root.findAllByProps({ 'aria-label': '制作流程' })[0].findAllByType('button').map(item => item.props['aria-label']), ['项目', '剧本', '锚点', '分镜', '成片'])
  assert.equal(view.root.findAllByProps({ className: 'elysium-planning' }).length, 0)
  assert.equal(view.root.findAllByType('button').find(item => item.children.join('') === '继续到剧本').props.disabled, false)
  await act(async () => view.root.findByProps({ 'aria-label': '剧本' }).props.onClick())
  assert.ok(view.root.findAllByProps({ className: 'elysium-script-view' }).length)
  await act(async () => view.unmount())
})

test('batch timeline generation skips finalized episodes and stops at the failed episode', async () => {
  const plan = { series: entry(series), episodes: { 1: { timeline: entry({ beats: [] }) } } }
  const f = fixture({ plan, failEpisode: 3 })
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/planning').ScriptView, { projectId: '1234abcd' })) })
  await act(async () => view.root.findAllByType('button').find(item => item.children.join('') === '生成全部集时间线').props.onClick())
  assert.deepEqual(f.calls.filter(item => item.url.startsWith('/project/plan-generate')).map(item => item.body.episode), [2, 3])
  assert.match(JSON.stringify(view.toJSON()), /第 3 集：模型失败/)
  assert.match(JSON.stringify(view.toJSON()), /时间线进度 3\/3/)
  assert.equal(f.planning().episodes[2].timeline.versions.length, 1)
  await act(async () => view.unmount())
})

test('storyboard has no script tab; anchor image and shot adoption reach their endpoints', async () => {
  const value = project()
  value.acts = [{ title: '第一集', shots: [{ id: 'shot-1', role: 'lin', roles: ['lin'], scene: 'room', action: '开门', subtitle: '',
    status: 'succeeded', job_id: 'c'.repeat(32), prompt_finalized: true, accepted: false, notes: '' }] }]
  const plan = { series: entry(series), episodes: { 1: { timeline: entry({ beats: [] }), storyboard: entry({ shots: [{ id: 'shot-1', action: '开门' }] }), prompts: {} } } }
  const f = fixture({ value, plan })
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/anchors').AnchorView, { project: f.project(), busy: false, run: action => action() })) })
  await act(async () => view.root.findAllByType('button').find(item => item.children.join('') === '重新生成参考图').props.onClick())
  assert.deepEqual(f.calls.findLast(item => item.url.startsWith('/project/anchor-generate')).body, { project_id: value.id, role: 'lin' })
  await act(async () => view.unmount())
  await act(async () => { view = create(React.createElement(f.require('elysium/planning').StoryboardStepView, { projectId: value.id })) })
  assert.deepEqual(view.root.findByProps({ 'aria-label': '分镜步骤' }).findAllByType('button').map(item => item.children.join('')), ['分镜', '提示词'])
  await act(async () => view.root.findByProps({ 'aria-label': '镜 001' }).props.onClick())
  await act(async () => view.root.findAllByType('button').find(item => item.children.join('') === '采用此镜').props.onClick())
  assert.deepEqual(f.calls.findLast(item => item.url.startsWith('/project/update-shot')).body, { id: value.id, action: 'accept', data: { episode: 1, id: 'shot-1', accepted: true } })
  await act(async () => view.unmount())
})

test('film button requires every shot adopted and a reviewed plan', async () => {
  const value = project()
  value.acts = [{ title: '第一集', shots: [{ id: 'shot-1', role: 'lin', roles: ['lin'], scene: 'room', status: 'succeeded', accepted: false }] }]
  const plan = { series: entry(series), episodes: { 1: { timeline: entry({ beats: [] }), storyboard: entry({ shots: [] }), prompts: {} } } }
  const f = fixture({ value, plan })
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/planning').FilmStepView, { projectId: value.id })) })
  assert.equal(view.root.findAllByType('button').find(item => item.children.join('') === '合成本集').props.disabled, true)
  assert.match(JSON.stringify(view.toJSON()), /还有 1 个镜头未采用/)
  await act(async () => view.unmount())
  value.acts[0].shots[0].accepted = true
  const reviewed = fixture({ value, plan: { ...plan, episodes: { 1: { ...plan.episodes[1], timeline: entry({ beats: [] }, 1, true) } } } })
  await act(async () => { view = create(React.createElement(reviewed.require('elysium/planning').FilmStepView, { projectId: value.id })) })
  assert.equal(view.root.findAllByType('button').find(item => item.children.join('') === '合成本集').props.disabled, true)
  assert.match(JSON.stringify(view.toJSON()), /本集时间线需复核/)
  await act(async () => view.unmount())
})
