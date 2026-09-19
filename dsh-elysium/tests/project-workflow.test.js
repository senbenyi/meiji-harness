// 职责：验证阶段授权、空素材、AI 回写、版本失效和幂等视频提交。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProjectWorkflow } from '../src/server/projects/workflow.js'
import { startVideoJob } from '../src/server/workflows/videos/service.js'

test('project workflow requires current AI requests and human submission, preserves empty selections and invalidates stale results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-workflow-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), jobs = new Map(); let starts = 0
    const workflow = createProjectWorkflow(store, { assets: async () => ({ items: [] }), directors: async () => [], resolveBackend: async () => ({ service: 'comfyui' }), validatePlan: async () => {},
      start: async (args, exec, token) => {
        starts++; assert.ok(token); assert.equal(args.shots[0].duration, 3)
        const value = { job_id: 'a'.repeat(32), status: 'running' }; jobs.set(value.job_id, value); return value
      }, job: async id => jobs.get(id) })
    let p = await store.change('create', { title: '恋爱短剧' })
    assert.equal(p.mode, 'director'); assert.equal(p.director, null)
    p = await workflow.action('configure', { id: p.id, revision: 0, configuration: {}, mode: 'free' })
    assert.deepEqual(p.configuration, { male: null, female: null, supporting: [], props: [], scene: null, theme: [], director: null, reference_text: '' })
    await assert.rejects(startVideoJob({ project_id: p.id, duration: 3, shots: [] }), /人工审核/)
    await assert.rejects(workflow.action('submit', { id: p.id, revision: 1 }), /生成并审核/)
    p = await workflow.action('request', { id: p.id, revision: 1, session_id: 'session', stage: 'plot' })
    const request = p.workflow.request.id
    await assert.rejects(workflow.context(p.id, request, 'other'), /当前会话/)
    await assert.rejects(workflow.complete({ id: p.id, request_id: request, plot: '字'.repeat(201) }, 'session'), /200/)
    p = await workflow.complete({ id: p.id, request_id: request, plot: '两个成年人在咖啡馆重逢，相视而笑。' }, 'session')
    assert.equal(starts, 0)
    await assert.rejects(workflow.complete({ id: p.id, request_id: request, plot: '迟到结果' }, 'session'), /过期/)
    p = await workflow.action('request', { id: p.id, revision: 2, session_id: 'session', stage: 'storyboard' })
    const shots = [{ id: 'shot-1', duration: 3, action: '两人相视微笑', prompt: '咖啡馆，成年情侣相视微笑，中景，暖色光', camera: '缓慢推进' }]
    p = await workflow.complete({ id: p.id, request_id: p.workflow.request.id, shots }, 'session')
    assert.equal(starts, 0); assert.equal(p.acts[0].shots[0].camera, '缓慢推进')
    await Promise.all([workflow.action('submit', { id: p.id, revision: 2 }), workflow.action('submit', { id: p.id, revision: 2 })])
    assert.equal(starts, 1)
    jobs.set('a'.repeat(32), { job_id: 'a'.repeat(32), status: 'succeeded' })
    p = await workflow.refresh(p.id)
    assert.equal(p.workflow.stage, 'complete'); assert.equal(p.deliverables.length, 1)
    p = await workflow.action('edit', { id: p.id, revision: 2, plot: '成年情侣在雨中相遇，共撑一把伞。' })
    assert.equal(p.workflow.approval, null); assert.equal(p.workflow.job_id, null)
    await assert.rejects(workflow.action('submit', { id: p.id, revision: 3 }), /生成并审核/)
    await assert.rejects(workflow.action('configure', { id: p.id, revision: 1, configuration: {} }), /项目已变化/)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('selected material categories, single choice, novel paging and stale requests are validated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-materials-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), character = 'a'.repeat(32), prop = 'b'.repeat(32), theme = 'c'.repeat(32)
    const workflow = createProjectWorkflow(store, { assets: async () => ({ items: [{ id: character, category: 'character', title: '男主', has_image: true, comfyui_view_url: 'http://server/view?filename=male.png' }, { id: prop, category: 'prop', title: '手表' }, { id: theme, category: 'theme', title: '青梅重逢' }] }), directors: async () => [] })
    let p = await store.change('create', { title: '长篇改编' })
    await assert.rejects(workflow.action('configure', { id: p.id, revision: 0, configuration: { male: prop } }), /分类/)
    await assert.rejects(workflow.action('configure', { id: p.id, revision: 0, configuration: { scene: [character] } }), /素材 ID/)
    p = await workflow.action('configure', { id: p.id, revision: 0, configuration: { male: character, props: [prop], theme, reference_text: '文'.repeat(13000) } })
    assert.deepEqual(p.configuration.theme, [theme])
    p = await workflow.action('request', { id: p.id, revision: 1, stage: 'plot', session_id: 's' })
    const context = await workflow.context(p.id, p.workflow.request.id, 's')
    assert.equal(context.reference_text.length, 12000); assert.equal(context.next_offset, 12000)
    assert.equal((await workflow.context(p.id, p.workflow.request.id, 's', 12000)).reference_text.length, 1000)
    await workflow.action('cancel', { id: p.id, revision: 1 })
    await workflow.action('configure', { id: p.id, revision: 1, configuration: {} })
    await assert.rejects(workflow.complete({ id: p.id, request_id: p.workflow.request.id, plot: '迟到剧情' }, 's'), /过期/)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource, testClientSource } from '../scripts/loader.js'

test('project UI keeps roles and cardinalities, sends next-step request into the active Harness session', async () => {
  const modules = new Map(), cache = new Map(), requests = [], sent = []
  runInNewContext(testClientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      if (url.startsWith('/media/list')) return { ok: true, json: async () => ({ items: [], has_more: false }) }
      if (url.startsWith('/director/list')) return { ok: true, json: async () => [] }
      const body = JSON.parse(options.body); requests.push(body)
      return { ok: true, json: async () => ({ id: body.id, workflow: { revision: body.revision, request: { id: 'request-1' } } }) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const generation = require('elysium/project-generation')
  generation.apply({ sessions: { list: { getSnapshot: () => ({ current: 'active-session' }) }, scope: id => { assert.equal(id, 'active-session'); return { get: () => ({ send: async text => sent.push(text) }) } } }, slots: { inject: (_name, register) => register(), register() {} }, uiConversation: { events: { register() {} } } })
  let view
  const project = { id: '1234abcd', mode: 'director', brief: '恋爱视频', configuration: { supporting: [], props: [] }, workflow: { revision: 4 } }
  await act(async () => { view = create(React.createElement(require('elysium/project-configuration').ProjectConfiguration, { project, busy: false, onChange() {} })) })
  assert.equal(view.root.findByProps({ 'aria-label': '项目模式' }).props.value, 'director')
  for (const label of ['男主', '女主', '场景']) assert.equal(view.root.findByProps({ 'aria-label': label }).props.multiple, false)
  for (const label of ['配角', '道具']) assert.equal(view.root.findByProps({ 'aria-label': label }).props.multiple, true)
  assert.equal(view.root.findByProps({ 'aria-label': '题材' }).props.role, 'group')
  await generation.generate(project, 'plot')
  assert.equal(requests[0].session_id, 'active-session'); assert.equal(requests[0].stage, 'plot')
  assert.match(sent[0], /request_id=request-1/); assert.match(sent[0], /不生成视频/)
  await act(async () => view.unmount())
})

test('single-shot API compilation preserves duration and snapshots the selected backend; unsupported multi-shot does not launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-backend-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(); let submitted, checked
    const backend = { service: 'video', provider: 'fixture' }
    const workflow = createProjectWorkflow(store, { resolveBackend: async () => backend,
      validatePlan: async (selected, plan) => { checked = { selected, plan } },
      start: async args => { submitted = args; return { job_id: 'c'.repeat(32), status: 'queued' } } })
    let p = await store.change('create', { title: 'API 项目' })
    p = await store.transact(p.id, value => {
      value.workflow.plot = '成年情侣重逢。'; value.workflow.storyboard_revision = 0
      value.acts = [{ episode_id: 'episode-1', title: '第一幕', shots: [{ id: 'one', role: '', mode: 'independent', duration: 5, action: '微笑', prompt: 'Couple smiling', subtitle: '', notes: '', job_id: null, status: 'pending' }] }]
      return ['acts']
    })
    p = await workflow.action('submit', { id: p.id, revision: 0 })
    assert.equal(submitted.mode, 't2va'); assert.equal(submitted.duration_seconds, 5); assert.equal(submitted.shots, undefined)
    assert.deepEqual(checked.selected, backend); assert.deepEqual(p.workflow.approval.backend, backend)
    await store.transact(p.id, value => { value.workflow.job_id = null; value.workflow.approval = null; value.acts[0].shots.push({ ...value.acts[0].shots[0], id: 'two' }); return ['acts'] })
    await assert.rejects(workflow.action('submit', { id: p.id, revision: 0 }), /不支持逐镜生成合片/)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('workflow overview opens isolated details, guards drafts and does not interrupt overview on background updates', async () => {
  const modules = new Map(), cache = new Map(); let allowLeave = false
  runInNewContext(clientSource(), { structuredClone, window: { confirm: () => allowLeave, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } } })
  cache.set('elysium/project-api', { workflowAction() {} })
  cache.set('elysium/project-configuration', { ProjectConfiguration: () => React.createElement('div', null, '配置表单') })
  cache.set('elysium/delivery', { DeliveryView: () => React.createElement('div', null, '视频详情') })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const { ProjectWorkflow } = require('elysium/project-generation')
  const project = { id: '1234abcd', updated_at: 1, title: '故事', configuration: {}, workflow: { revision: 1, stage: 'plot', plot: '相遇。' }, production: { revision: 0, original_request: '故事', style: '', aspect_ratio: '9:16', target_seconds: 15, story: { text: '相遇。', scenes: [{ id: 'scene-a', title: '相遇', description: '相遇。', duration: 15 }] }, segments: [], assets: [], exports: [], timeline: { clips: [] } }, acts: [], deliverables: [] }
  let view
  const render = value => React.createElement(ProjectWorkflow, { project: value, busy: false, run: async () => true })
  await act(async () => { view = create(render(project)) })
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-card' }).length, 1)
  await act(async () => view.root.findByProps({ 'aria-label': '打开Scene 1' }).props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-card' }).length, 0)
  assert.equal(view.root.findByProps({ 'aria-label': '场景剧情' }).props.value, '相遇。')
  await act(async () => view.root.findByProps({ 'aria-label': '场景剧情' }).props.onChange({ target: { value: '编辑中的剧情' } }))
  const back = () => view.root.findByProps({ className: 'elysium-app-navbar' }).findByType('button').props.onClick()
  await act(async () => back())
  assert.equal(view.root.findByProps({ 'aria-label': '场景剧情' }).props.value, '编辑中的剧情')
  allowLeave = true
  await act(async () => back())
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-card' }).length, 1)
  await act(async () => view.update(render({ ...project, updated_at: 2, workflow: { ...project.workflow, stage: 'storyboard' } })))
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-card' }).length, 1)
  await act(async () => view.root.findByProps({ 'aria-label': '打开Scene 1' }).props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '场景剧情' }).props.value, '相遇。')
  assert.ok(view.root.findByProps({ className: 'elysium-step-detail-footer' }))
  await act(async () => view.unmount())
})

test('episodes isolate requests, edits, approvals, duplicate submits and finished films', async () => {
  const root = await mkdtemp(join(tmpdir(), 'episodes-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), jobs = new Map(), calls = []
    const workflow = createProjectWorkflow(store, { resolveBackend: async () => ({ service: 'comfyui' }), validatePlan: async () => {},
      start: async args => { calls.push(args); const result = { job_id: String(calls.length).repeat(32), status: 'running' }; jobs.set(result.job_id, result); return result }, job: async id => jobs.get(id) })
    let p = await store.change('create', { title: '三集恋爱故事' })
    p = await workflow.action('configure', { id: p.id, revision: 0, configuration: {}, episode_count: 3 })
    assert.equal(p.episodes.length, 3)
    p = await workflow.action('request', { id: p.id, revision: p.workflow.revision, stage: 'plot', session_id: 'session' })
    const requestId = p.workflow.request.id
    assert.equal((await workflow.context(p.id, requestId, 'session')).episode_count, 3)
    await assert.rejects(workflow.complete({ id: p.id, request_id: requestId, episodes: [{ id: 'episode-1', title: '相遇', plot: '相遇。' }] }, 'session'), /全部分集/)
    p = await workflow.complete({ id: p.id, request_id: requestId, episodes: p.episodes.map((e, i) => ({ id: e.id, title: ['相遇', '约定', '重逢'][i], plot: `第${i + 1}集成年情侣的故事。` })) }, 'session')
    const act = async (name, episodeId, body = {}) => { p = await workflow.action(name, { id: p.id, episode_id: episodeId, revision: p.episodes.find(e => e.id === episodeId).workflow.revision, ...body }); return p }
    for (const id of ['episode-1', 'episode-2']) {
      await act('request', id, { stage: 'storyboard', session_id: 'session' })
      const req = p.episodes.find(e => e.id === id).workflow.request.id
      await assert.rejects(workflow.complete({ id: p.id, request_id: req, episode_id: id === 'episode-1' ? 'episode-2' : 'episode-1', shots: [] }, 'session'), /剧集/)
      p = await workflow.complete({ id: p.id, request_id: req, shots: [{ id: 's1', duration: 3, action: '微笑', prompt: '成年情侣相视微笑' }] }, 'session')
    }
    assert.equal(p.acts.length, 2); assert.notEqual(p.acts[0].shots[0].id, p.acts[1].shots[0].id)
    const rev1 = p.episodes[0].workflow.revision
    await Promise.all([workflow.action('submit', { id: p.id, episode_id: 'episode-1', revision: rev1 }), workflow.action('submit', { id: p.id, episode_id: 'episode-1', revision: rev1 })])
    assert.equal(calls.length, 1); assert.equal(calls[0].episode_id, 'episode-1'); assert.equal(calls[0].shots.length, 1)
    p = await store.read(p.id)
    const approval = p.episodes[0].workflow.approval
    await assert.rejects(startVideoJob({ project_id: p.id, episode_id: 'episode-2', ...approval.plan }, undefined, approval.token), /人工审核/)
    await assert.rejects(startVideoJob({ project_id: p.id, ...approval.plan }, undefined, approval.token), /有效剧集/)
    await act('edit', 'episode-2', { plot: '第二集修改后的剧情。', title: '新的约定' })
    assert.equal(p.episodes[0].workflow.job_id, '1'.repeat(32)); assert.equal(p.episodes[0].workflow.revision, rev1)
    jobs.set('1'.repeat(32), { job_id: '1'.repeat(32), status: 'succeeded' })
    p = await workflow.refresh(p.id)
    assert.equal(p.deliverables.length, 1); assert.equal(p.deliverables[0].episode_id, 'episode-1'); assert.equal(p.deliverables[0].label, '相遇')
    assert.equal(p.episodes[1].title, '新的约定'); assert.equal(p.episodes[1].workflow.approval, null)
    assert.equal(p.acts.find(a => a.episode_id === 'episode-2').shots[0].status, 'pending')
    await assert.rejects(workflow.action('submit', { id: p.id, revision: p.workflow.revision }), /选择.*剧集/)
    await assert.rejects(workflow.action('configure', { id: p.id, revision: p.workflow.revision, configuration: {}, episode_count: 1 }), /减少集数/)
    p = await workflow.action('configure', { id: p.id, revision: p.workflow.revision, configuration: {}, episode_count: 3 })
    assert.ok(p.episodes.every(e => e.workflow.plot_stale && !e.workflow.approval))
    assert.equal(p.deliverables[0].episode_id, 'episode-1')
  }) } finally { await rm(root, { recursive: true, force: true }) }
})
