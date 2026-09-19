// 职责：验证按集浏览、单镜保存作用域、返回位置恢复和指定成片播放。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { testClientSource } from '../scripts/loader.js'

const projectFixture = () => ({ id: '1234abcd', title: '三集故事', updated_at: 1, mode: 'director', episode_count: 3,
  workflow: { revision: 1, stage: 'storyboard' }, configuration: {}, selected_materials: [],
  episodes: [1, 2, 3].map(n => ({ id: `episode-${n}`, title: `故事${n}`, workflow: { revision: n, stage: 'storyboard', plot: `剧情${n}`, storyboard_revision: n } })),
  acts: [1, 2, 3].map(n => ({ episode_id: `episode-${n}`, title: '分镜', shots: [{ id: `episode-${n}-s1`, duration: n + 2, action: `动作${n}`, prompt: `描述${n}`, mode: 'independent' }] })),
  deliverables: [1, 2, 3].map(n => ({ episode_id: `episode-${n}`, type: 'video', label: `成片${n}`, job_id: String(n).repeat(32) })) })

test('episode cards drill into a shot, save only that episode and restore list scroll position', async () => {
  const modules = new Map(), cache = new Map(), actions = [], nodes = []
  runInNewContext(testClientSource(), { window: { confirm: () => true, __ELYSIUM_MEDIA__: { token: 't', base: '/media' }, __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, URLSearchParams, URL })
  let project = projectFixture(), view
  cache.set('elysium/project-api', { workflowAction: async (id, action, body) => {
    actions.push({ id, action, body }); project = { ...project, updated_at: 2, acts: project.acts.map(a => a.episode_id === body.episode_id ? { ...a, shots: body.shots } : a) }; return project
  } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const Component = require('elysium/episode-workflow').ProjectWorkflow
  const render = () => React.createElement(Component, { project, busy: false, run: async fn => { await fn(); view.update(render()); return true } })
  await act(async () => { view = create(render(), { createNodeMock: element => { const node = { scrollTop: 0, scrollLeft: 0, clientWidth: 440, scrollBy() {} }; nodes.push({ className: element.props.className, node }); return node } }) })
  const click = label => act(async () => view.root.findByProps({ 'aria-label': label }).props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-card' }).length, 9)
  assert.equal(view.root.findAllByProps({ className: 'elysium-app-navbar' }).length, 1)
  await click('打开第 2 集分镜')
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-shot-row' }).length, 1)
  assert.match(JSON.stringify(view.toJSON()), /动作2/); assert.doesNotMatch(JSON.stringify(view.toJSON()), /动作1/)
  await act(async () => view.root.findByProps({ className: 'elysium-step-detail-body' }).props.onScroll({ currentTarget: { scrollTop: 92 } }))
  await click('编辑镜头 1')
  assert.equal(view.root.findByProps({ 'aria-label': '画面动作' }).props.value, '动作2')
  await act(async () => view.root.findByProps({ 'aria-label': '画面动作' }).props.onChange({ target: { value: '第二集新动作' } }))
  await act(async () => view.root.findAllByType('button').find(b => b.children.join('') === '保存镜头').props.onClick())
  assert.equal(actions[0].body.episode_id, 'episode-2'); assert.equal(actions[0].body.revision, 2)
  assert.equal(actions[0].body.shots.length, 1); assert.equal(actions[0].body.shots[0].id, 'episode-2-s1')
  assert.equal(project.acts[0].shots[0].action, '动作1')
  assert.equal(nodes.filter(item => item.className === 'elysium-step-detail-body').at(-1).node.scrollTop, 92)
  await click('返回项目总览')
  await click('打开第 3 集成片版本 1')
  const video = view.root.findByType('video')
  assert.match(video.props.src, new RegExp('3'.repeat(32))); assert.equal(video.props.autoPlay, true)
  assert.doesNotMatch(video.props.src, new RegExp('1'.repeat(32)))
  assert.equal(view.root.findByType('h1').children.join(''), '第 3 集 · 成片')
  await act(async () => view.unmount())
})

test('overview Next buttons require all episodes and submit the whole series', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  runInNewContext(testClientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media' }, __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, URLSearchParams, URL })
  cache.set('elysium/project-api', { workflowAction: async (id, action, body) => { calls.push({ id, action, body }); return project } })
  cache.set('elysium/project-generation', { generate: async (p, stage, episodeId) => { calls.push({ stage, episodeId }); return p } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const Component = require('elysium/episode-workflow').ProjectWorkflow
  let project = projectFixture(), view
  const render = () => React.createElement(Component, { project, busy: false, run: async fn => { await fn(); return true } })
  await act(async () => { view = create(render()) })
  const next = part => view.root.findAllByType('button').find(b => b.children.join('').includes(part))
  assert.equal(next('生成全部分镜').props.disabled, false)
  await act(async () => next('生成全部分镜').props.onClick())
  assert.equal(calls[0].stage, 'storyboard'); assert.equal(calls[0].episodeId, undefined)
  project.episodes[2].workflow.plot_stale = true
  project.episodes[2].workflow.storyboard_revision = null
  await act(async () => view.update(render()))
  assert.equal(next('生成全部分镜').props.disabled, true)
  assert.equal(next('生成全部成片').props.disabled, true)
  assert.equal(next('确认全部成片').props.disabled, true)
  project.episodes[2].workflow.plot_stale = false
  project.episodes[2].workflow.storyboard_revision = 3
  await act(async () => view.update(render()))
  await act(async () => next('生成全部成片').props.onClick())
  assert.equal(calls[1].action, 'submit-series'); assert.equal(calls[1].body.episode_id, undefined)
  for (let i = 0; i < 3; i++) Object.assign(project.episodes[i].workflow, { stage: 'complete', job_id: project.deliverables[i].job_id })
  await act(async () => view.update(render()))
  assert.equal(next('确认全部成片').props.disabled, false)
  await act(async () => next('确认全部成片').props.onClick())
  assert.equal(calls[2].action, 'finish')
  project.reviewed_at = Date.now()
  await act(async () => view.update(render()))
  assert.equal(next('项目已完成').props.disabled, true)
  await act(async () => view.unmount())
})
