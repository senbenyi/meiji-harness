// 职责：验证工作台五步导航、生产面板控制、依赖放行与成片页展示。
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

const entry = (value, finalized = 1, needs_review = false) => ({ versions: [{ version: 1, value }], finalized, needs_review })
const series = { episode_count: 3, episode_seconds: 10, characters: [{ id: 'lin' }], scenes: [{ id: 'room' }],
  episodes: [1, 2, 3].map(number => ({ number, title: `第 ${number} 集`, summary: '雨夜', hook: '门外有人' })) }
const auto = { enabled: false, until_episode: null, anchors_confirmed: false, cascade_confirmed: false, paused: null, attempts: {} }
const shot = (id, extra = {}) => ({ id, roles: ['lin'], scene: 'room', shot_size: '近景', camera: '固定', action: `动作 ${id}`, duration: 5, dialogue: [{ role: 'lin', text: '你好' }],
  subtitle: '你好', prompt: '提示词', keyframe_prompt: 'frame', prompt_finalized: true, take: 1, keyframe_job_id: 'c'.repeat(32), job_id: 'd'.repeat(32), status: 'succeeded', ...extra })
const project = (extra = {}) => ({ id: '1234abcd', title: '雨夜', director: 'director-a', genre: '悬疑', synopsis: '一封信', updated_at: 1, auto, materials: [], anchors: [
  { role: 'lin', kind: 'character', label: '林', description: '灰外套', image_prompt: 'man', image_job_id: 'a'.repeat(32), source: { type: 'job', job_id: 'a'.repeat(32) } },
  { role: 'scene-room', kind: 'scene', label: '公寓', description: '雨夜', source: null }], episodes: [], ...extra })

function fixture({ value = project(), plan = { series: entry(series), episodes: {} } } = {}) {
  let current = structuredClone(value)
  const calls = [], modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { AbortController, setTimeout, clearTimeout, URLSearchParams, URL,
    window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' },
      __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, document: {},
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, body })
      const reply = value => ({ ok: true, json: async () => structuredClone(value) })
      if (url.startsWith('/director/list')) return reply([])
      if (url.startsWith('/project/plan-read')) return reply(plan)
      if (url.startsWith('/project/episode')) {
        const number = Number(new URL(url, 'http://localhost').searchParams.get('number')), episode = current.episodes.find(item => item.number === number)
        return reply({ ...current, episode: number, acts: episode?.acts || [], deliverables: episode?.deliverables || [], film_task: episode?.film_task || null })
      }
      if (url.startsWith('/project/auto-start')) current.auto = { ...current.auto, enabled: true, until_episode: body.until_episode }
      if (url.startsWith('/project/auto-pause')) current.auto = { ...current.auto, enabled: false }
      if (url.startsWith('/project/auto-resume')) current.auto = { ...current.auto, enabled: true, paused: null }
      if (url.startsWith('/media/status')) return reply({ has_image: true, has_video: true })
      return reply(current)
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, calls, project: () => current }
}
const text = view => JSON.stringify(view.toJSON())
const button = (view, label) => view.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.join('') === label)
const click = (view, label) => act(async () => button(view, label).props.onClick())
async function mount(f, tab) {
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: '1234abcd', viewState: tab ? { projectTab: tab } : {}, back() {} })) })
  return view
}

test('project navigation has five steps, opens at the first unfinished stage and lets anchors follow the series', async () => {
  const f = fixture(), view = await mount(f)
  assert.deepEqual(view.root.findByProps({ 'aria-label': '制作流程' }).findAllByType('button').map(node => node.props['aria-label']), ['项目', '剧本', '锚点', '分镜', '成片'])
  assert.equal(view.root.findByProps({ 'aria-label': '锚点' }).props['aria-current'], 'step')
  await click(view, '剧本')
  assert.equal(button(view, '继续到锚点').props.disabled, false)
  assert.doesNotMatch(text(view), /生成全部集时间线/)
  await click(view, '锚点')
  assert.equal(button(view, '继续到分镜').props.disabled, false)
  await click(view, '分镜')
  assert.equal(button(view, '继续到成片').props.disabled, true)
  await act(async () => view.unmount())
})

test('production panel starts a range, pauses, jumps to the paused shot and resumes', async () => {
  const paused = { reason: '第 2 集镜头 s9 生成失败：显存不足', episode: 2, step: 'shot', shot_id: 's9' }
  const f = fixture(), view = await mount(f, 'project')
  assert.match(text(view), /未开启/)
  await act(async () => view.root.findByProps({ 'aria-label': '生产范围' }).props.onChange({ target: { value: '2' } }))
  await click(view, '一键生产')
  assert.deepEqual(f.calls.find(call => call.url.startsWith('/project/auto-start')).body, { id: '1234abcd', until_episode: 2 })
  assert.match(text(view), /生产中 · 第 1 集时间线/)
  await click(view, '暂停')
  assert.deepEqual(f.calls.find(call => call.url.startsWith('/project/auto-pause')).body, { id: '1234abcd' })
  f.project().auto = { ...f.project().auto, enabled: true, paused }
  const again = await mount(f, 'project')
  assert.match(text(again), /显存不足/)
  await click(again, '去处理')
  assert.equal(again.root.findByProps({ 'aria-label': '分镜' }).props['aria-current'], 'step')
  await click(again, '继续')
  assert.ok(f.calls.some(call => call.url.startsWith('/project/auto-resume')))
  assert.doesNotMatch(text(again), /显存不足/)
  await act(async () => { view.unmount(); again.unmount() })
})

test('film tab shows the pipeline status and lists the latest film and subtitle downloads', async () => {
  const films = [{ type: 'film', label: '第 1 集 · 雨夜', job_id: 'e'.repeat(32), created_at: 1, duration_sec: 10 },
    { type: 'film', label: '第 1 集 · 雨夜', job_id: 'f'.repeat(32), created_at: 2, duration_sec: 10 },
    { type: 'subtitle', label: '第 1 集 · 雨夜', job_id: '9'.repeat(32), created_at: 2 }]
  const value = project({ episodes: [{ number: 1, acts: [{ title: '第 1 集', shots: [shot('s1')] }], deliverables: films, film_task: { status: 'succeeded' } }] })
  const f = fixture({ value }), view = await mount(f, 'film')
  assert.match(text(view), /本集成片已完成/)
  assert.equal(view.root.findByProps({ 'aria-label': '选择成片版本' }).props.value, 'f'.repeat(32))
  const links = view.root.findAllByType('a').map(node => [node.props['aria-label'], new URL(node.props.href, 'http://localhost').searchParams.get('job')])
  assert.deepEqual(links, [['下载成片 第 1 集 · 雨夜', 'f'.repeat(32)], ['下载字幕 第 1 集 · 雨夜', '9'.repeat(32)], ['下载成片 第 1 集 · 雨夜', 'e'.repeat(32)]])
  assert.equal(button(view, '合成本集'), undefined)
  await act(async () => view.unmount())
  const failed = fixture({ value: project({ episodes: [{ number: 1, acts: [], deliverables: [], film_task: { status: 'failed', error: '音轨缺失' } }] }) })
  const failedView = await mount(failed, 'film')
  assert.match(text(failedView), /合成失败：音轨缺失/)
  await act(async () => failedView.unmount())
})
