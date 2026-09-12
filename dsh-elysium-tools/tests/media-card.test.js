import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

async function fixture(responses, block = {}) {
  const bundles = new Map(), cache = new Map(), timers = new Map(), requests = [], slots = []
  let sequence = 0
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'test', base: '/plugins/dsh-elysium/media' },
    __ModuleLoader__: { load: item => bundles.set(item.id, item.factory) } },
    URLSearchParams, AbortController, structuredClone,
    setTimeout: run => { const id = ++sequence; timers.set(id, run); return id }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options })
      const value = responses.shift()
      if (value instanceof Error) throw value
      return { ok: !value.httpError, status: value.httpError || 200, json: async () => value }
    },
  })
  const require = name => {
    if (name === 'react') return React
    if (!cache.has(name)) cache.set(name, bundles.get(name)(require))
    return cache.get(name)
  }
  require(pkg.name).apply({ effect: run => run(), inputTriggers: { registerSource: () => () => {} }, uiConversation: { events: { register() {} } }, settingsScope: { bind: () => ({}) }, slots: { inject: (_, run) => run(), register: (spec, component) => {
    if (spec.name === 'tool.call.toolview') slots.push({ spec, component })
  } } })
  assert.deepEqual(slots.map(s => s.spec.key), ['workflow_generate_video', 'workflow_resume_video'])
  let view
  await act(async () => { view = create(React.createElement(require('elysium-tools/media-card').MediaTaskCard, { sessionId: 'session', callId: 'call', block })) })
  return { view, requests, timers, definition: require('elysium-tools/media-results').definition,
    tick: async () => act(async () => { const [id, run] = timers.entries().next().value; timers.delete(id); await run() }),
    close: async () => act(async () => view.unmount()) }
}

test('same card progresses to playable result and stops polling', async () => {
  const f = await fixture([{ status: 'running', stage: 'execute' }, { status: 'succeeded', has_video: true,
    job_id: 'a', media_info: { duration_seconds: 8, width: 640, height: 384, frame_rate: 24 }, validation: { full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' } }], { argsRaw: JSON.stringify({ width: 640, height: 384 }) })
  try {
    assert.match(f.view.root.findByProps({ role: 'status' }).children.join(''), /工作流执行中/)
    assert.equal(f.view.root.findAllByType('video').length, 0)
    assert.equal(f.view.root.findByProps({ role: 'progressbar' }).props['aria-label'], '视频生成中')
    assert.equal(f.view.root.findAllByProps({ className: 'elysium-spinner' }).length, 1)
    const previewRatio = f.view.root.findByProps({ className: 'elysium-preview' }).props.style.aspectRatio
    await f.tick()
    assert.equal(f.view.root.findByProps({ className: 'elysium-preview' }).props.style.aspectRatio, previewRatio)
    const video = f.view.root.findByType('video')
    assert.equal(f.view.root.findByProps({ 'aria-label': '媒体加载中' }).props.role, 'progressbar')
    await act(async () => video.props.onLoadedData())
    assert.equal(f.view.root.findAllByProps({ role: 'progressbar' }).length, 0)
    assert.match(video.props.src, /^\/plugins\/dsh-elysium\/media\/video\?/)
    assert.equal(video.props.controls, false)
    assert.ok(!video.props.src.includes('3080'))
    assert.match(f.view.root.findByProps({ 'aria-label': '下载视频' }).props.href, /media\/download\?/)
    assert.equal(f.timers.size, 0)
    assert.doesNotMatch(JSON.stringify(f.view.toJSON()), /文件与规格检查通过|人工验收/)
    assert.equal(f.requests.length, 2)
  } finally { await f.close() }
})

test('completed card puts preview above metadata without download controls', async () => {
  const url = 'https://pod.test/view?filename=final.mp4&subfolder=elysium/test&type=output&format=video%2Fmp4'
  const f = await fixture([{ status: 'succeeded', has_video: true, comfyui_view_url: url }])
  try {
    assert.match(f.view.root.findByType('video').props.src, /^https:\/\/pod\.test\//)
    assert.equal(f.view.root.findAllByType('a').length, 0)
    const children = f.view.root.findByType('section').children
    assert.equal(children[0].props.className, 'elysium-preview')
    assert.equal(children[1].props.className, 'elysium-info')
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})

test('a completed tool result plays without polling the media service', async () => {
  const url = 'https://pod.test/view?filename=final.mp4&type=output'
  const f = await fixture([], { content: [{ type: 'text', text: JSON.stringify({ job_id: 'a', status: 'succeeded', comfyui_view_url: url }) }] })
  try {
    assert.match(f.view.root.findByType('video').props.src, /^https:\/\/pod\.test\//)
    assert.equal(f.requests.length, 0)
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})

test('completed preview uses specification dimensions and actual job details without media_info', async () => {
  const job = { job_id: '6e050097ab7b37578357ff0e111dc53d', status: 'succeeded',
    comfyui_view_url: 'https://pod.test/view?filename=final.mp4', timings: { total_ms: 33123 }, profile: 'preview',
    specification: { width: 384, height: 512, seconds: 73 / 24, steps: 8, audio: 'joint-generation-and-decoding' } }
  for (const block of [null, { content: [{ type: 'text', text: JSON.stringify(job) }] }]) {
    const f = await fixture(block ? [] : [job], block || {})
    try {
      assert.equal(f.view.root.findByProps({ className: 'elysium-preview' }).props.style.aspectRatio, '384 / 512')
      const details = f.view.root.findByProps({ className: 'elysium-details' }).findAllByType('p').flatMap(p => p.children.filter(child => typeof child === 'string')).join('\n')
      assert.match(JSON.stringify(f.view.toJSON()), /6e050097ab7b37578357ff0e111dc53d/)
      assert.match(details, /任务耗时：33.1 秒/)
      assert.match(details, /生成规格：预览档、384×512、约 3 秒视频、8 步、带音频/)
      await act(async () => f.view.root.findByType('video').props.onLoadedMetadata({ currentTarget: { videoWidth: 640, videoHeight: 360 } }))
      assert.equal(f.view.root.findByProps({ className: 'elysium-preview' }).props.style.aspectRatio, '640 / 360')
      assert.equal(f.view.root.findByType('section').props.style.maxWidth, 560)
    } finally { await f.close() }
  }
})

test('missing task metadata does not invent duration or generation specifications', async () => {
  const f = await fixture([{ status: 'succeeded', comfyui_view_url: 'https://pod.test/view?filename=old.mp4' }])
  try {
    assert.doesNotMatch(JSON.stringify(f.view.toJSON()), /任务耗时|生成规格/)
    await act(async () => f.view.root.findByType('video').props.onLoadedMetadata({ currentTarget: { videoWidth: 384, videoHeight: 512 } }))
    assert.equal(f.view.root.findByProps({ className: 'elysium-preview' }).props.style.aspectRatio, '384 / 512')
  } finally { await f.close() }
})

test('rejected arguments show a compact record without a task card or polling', async () => {
  const f = await fixture([], { isError: true, content: [{ type: 'text', text: 'Error: [MODEL_INPUT_INVALID] i2va 缺少 first_frame' }] })
  try {
    assert.equal(f.view.root.findAllByType('section').length, 0)
    assert.equal(f.view.root.findByType('summary').children.join(''), '媒体参数校验未通过（未创建任务）')
    assert.equal(f.requests.length, 0)
    assert.equal(f.timers.size, 0)
    assert.equal(f.view.root.findAllByProps({ role: 'progressbar' }).length, 0)
  } finally { await f.close() }
})
test('refresh can recover a completed job even when the tool block is still running', async () => {
  const f = await fixture([{ status: 'succeeded', has_video: true }])
  try { assert.equal(f.view.root.findAllByType('video').length, 1); assert.equal(f.timers.size, 0) }
  finally { await f.close() }
})
test('mode validation errors do not appear as running jobs', async () => {
  const f = await fixture([], { isError: true, content: [{ type: 'text', text: 'Error: [MODEL_INPUT_INVALID] i2va 缺少 first_frame' }] })
  try {
    assert.equal(f.view.root.findAllByType('section').length, 0)
    assert.equal(f.requests.length, 0)
    assert.equal(f.timers.size, 0)
    assert.match(JSON.stringify(f.view.toJSON()), /未创建任务/)
  } finally { await f.close() }
})
test('execution stage reports video generation without claiming review passed', async () => {
  const f = await fixture([{ status: 'running', stage: 'execute' }])
  try {
    assert.match(f.view.root.findByProps({ role: 'status' }).children.join(''), /工作流执行中/)
    assert.equal(f.view.root.findAllByType('video').length, 0)
  } finally { await f.close() }
})
test('network interruption reconnects, whereas expired credentials stop polling', async () => {
  const f = await fixture([new Error('disconnected'), { httpError: 401, error: '请刷新页面' }, { httpError: 403 }])
  try {
    assert.match(JSON.stringify(f.view.toJSON()), /disconnected/)
    await f.tick()
    assert.match(JSON.stringify(f.view.toJSON()), /请刷新页面/)
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})
test('failed production stays failed and does not trigger generation or claim success', async () => {
  const f = await fixture([{ status: 'failed', job_id: 'job', error: 'generation failed' }])
  try {
    assert.match(JSON.stringify(f.view.toJSON()), /generation failed/)
    assert.equal(f.view.root.findAllByType('video').length, 0)
    assert.equal(f.timers.size, 1)
    assert.ok(f.requests.every(r => r.url.includes('/status?')))
  } finally { await f.close() }
})
test('unmount aborts the request and removes pending polling timers', async () => {
  const f = await fixture([{ status: 'running' }])
  assert.equal(f.timers.size, 1)
  await f.close()
  assert.equal(f.timers.size, 0)
  assert.equal(f.requests[0].options.signal.aborted, true)
})

test('server URL playback failure reports once and retries the same URL without local fallback', async () => {
  const url='https://pod.test/view?filename=final.mp4'
  const f=await fixture([], {content:[{type:'text',text:JSON.stringify({job_id:'a',status:'succeeded',comfyui_view_url:url})}]})
  try {
    assert.equal(f.view.root.findByType('video').props.src,url)
    await act(async()=>f.view.root.findByType('video').props.onError())
    assert.match(JSON.stringify(f.view.toJSON()),/预览加载失败/)
    assert.equal(f.requests.length,0)
    await act(async()=>f.view.root.findByProps({children:'重试播放'}).props.onClick())
    assert.equal(f.view.root.findByType('video').props.src,url)
  } finally { await f.close() }
})

test('interrupted session recovers original job and uses its server URL', async () => {
  const f = await fixture([{ status: 'succeeded', job_id: 'original', has_video: true,
    comfyui_view_url: 'https://pod.test/view?filename=final.mp4' }],
  { isError: true, content: [{ type: 'text', text: 'The tool call was interrupted; outcome unknown.' }] })
  try {
    assert.match(f.view.root.findByType('video').props.src, /^https:\/\/pod\.test\//)
    assert.equal(f.requests.length, 1)
    assert.match(f.requests[0].url, /\/status\?/)
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})

test('expired page credentials recover the original job with one retry', async () => {
  const f = await fixture([{ httpError: 401 }, { token: 'fresh', base: '/plugins/dsh-elysium/media' },
    { status: 'succeeded', has_video: true, job_id: 'original' }])
  try {
    assert.equal(f.requests.length, 3)
    assert.match(f.requests[0].url, /t=test/)
    assert.equal(f.requests[1].url, '/plugins/dsh-elysium/media/credentials')
    assert.equal(f.requests[1].options.headers['X-Elysium-Media-Refresh'], '1')
    assert.match(f.requests[2].url, /session=session&call=call&t=fresh/)
    assert.match(f.view.root.findByType('video').props.src, /t=fresh/)
    assert.equal(f.timers.size, 0)
    assert.equal(f.view.root.findAllByProps({ role: 'alert' }).length, 0)
  } finally { await f.close() }
})

test('a second 401 stops recovery instead of looping', async () => {
  const f = await fixture([{ httpError: 401 }, { token: 'fresh', base: '/plugins/dsh-elysium/media' },
    { httpError: 401, error: '凭据不可用' }])
  try {
    assert.equal(f.requests.length, 3)
    assert.equal(f.timers.size, 0)
    assert.match(JSON.stringify(f.view.toJSON()), /凭据不可用/)
  } finally { await f.close() }
})

test('portrait video fills a compact card and opens a dismissible player', async () => {
  const f = await fixture([{ status: 'succeeded', has_video: true, media_info: { width: 480, height: 854 } }])
  try {
    const thumbnail = f.view.root.findByType('video')
    assert.equal(f.view.root.findByType('section').props.style.maxWidth, 300)
    assert.equal(f.view.root.findByProps({ className: 'elysium-preview' }).props.style.aspectRatio, '480 / 854')
    await act(async () => thumbnail.props.onLoadedData())
    await act(async () => f.view.root.findByProps({ 'aria-label': '播放视频' }).props.onClick())
    const modal = f.view.root.findByType('dialog')
    assert.equal(modal.findByType('video').props.controls, true)
    await act(async () => modal.findByType('button').props.onClick())
    assert.equal(f.view.root.findAllByType('dialog').length, 0)
    await act(async () => f.view.root.findByProps({ 'aria-label': '放大查看' }).props.onClick())
    await act(async () => f.view.root.findByType('dialog').props.onClose())
    assert.equal(f.view.root.findAllByType('video').length, 1)
  } finally { await f.close() }
})


test('same-origin playback recovers a token rotated after status polling', async () => {
  const f = await fixture([{ status: 'succeeded', has_video: true }, { httpError: 401 },
    { token: 'rotated', base: '/plugins/dsh-elysium/media' }, { status: 'succeeded', has_video: true }])
  try {
    await act(async () => f.view.root.findByType('video').props.onError())
    assert.match(f.view.root.findByType('video').props.src, /t=rotated/)
    assert.equal(f.view.root.findAllByProps({ role: 'alert' }).length, 0)
    assert.equal(f.requests.length, 4)
  } finally { await f.close() }
})


test('history replay restores media for its own turn', async () => {
  const f = await fixture([], { content: [{ type: 'text', text: JSON.stringify({ job_id: 'a', status: 'succeeded', comfyui_view_url: 'http://localhost/view' }) }] })
  try {
    const d = f.definition
    let state = d.start({}, { event: { data: { turn: 2 } } })
    const call = { type: 'tool/call', data: { turn: 2, callId: 'media', name: 'workflow_generate_video' } }
    state = d.update({ state }, { event: call })
    const block = { content: [{ type: 'text', text: JSON.stringify({ job_id: 'a', status: 'succeeded' }) }] }
    const result = { type: 'tool/result', surfaceOp: 'append', seq: 12, data: { turn: 2, message: { source: { callId: 'media' }, content: [block] } } }
    assert.equal(d.match(result).role, 'update')
    assert.equal(d.match({ ...result, surfaceOp: 'replace' }), null)
    state = d.update({ state }, { event: result })
    assert.equal(d.buildLocationData({ state }, 'turn').turn, 2)
    assert.equal(state.results.length, 1)
    assert.equal(state.results[0].callId, 'media')
    state = d.update({ state }, { event: result })
    assert.equal(state.results.length, 1)
    const next = d.start({}, { event: { data: { turn: 3 } } })
    assert.equal(d.update({ state: next }, { event: result }).results.length, 0)
    const interrupted = { isError: true, content: [{ type: 'text', text: 'The tool call was interrupted; outcome unknown.' }] }
    state = d.update({ state }, { event: { ...result, data: { ...result.data, message: { ...result.data.message, content: [interrupted] } } } })
    assert.equal(state.results.length, 1)
    assert.equal(state.results[0].block, interrupted)
    const rejected = { isError: true, content: [{ type: 'text', text: '[MODEL_INPUT_INVALID] duration 必须为正整数' }] }
    const empty = d.update({ state: next }, { event: call })
    assert.equal(d.update({ state: empty }, { event: { ...result, data: { ...result.data, message: { ...result.data.message, content: [rejected] } } } }).results.length, 0)
  } finally { await f.close() }
})

test('remote completion with local transfer failure is not labeled generation failure', async () => {
  const f = await fixture([{status:'failed',remote_status:'succeeded',error:'连接中断'}])
  try {
    assert.match(JSON.stringify(f.view.toJSON()),/产物待校验/)
    assert.doesNotMatch(JSON.stringify(f.view.toJSON()),/生成失败/)
  } finally { await f.close() }
})

test('resume calls merge by job identity within a turn and remain on the original card across turns and replay', async () => {
  const f = await fixture([], { content: [{ type: 'text', text: JSON.stringify({ job_id: 'a', status: 'succeeded', comfyui_view_url: 'http://localhost/view' }) }] })
  try {
    for (let replay = 0; replay < 2; replay++) {
      const d = f.definition
      let state = d.start({}, { event: { data: { turn: 1 } } })
      const apply = (state, callId, jobId, turn) => {
        state = d.update({ state }, { event: { type: 'tool/call', data: { name: 'workflow_resume_video', callId, turn } } })
        return d.update({ state }, { event: { type: 'tool/result', seq: 10 + turn, data: { turn, message: { source: { callId }, content: [{ content: [{ type: 'text', text: JSON.stringify({ job_id: jobId, status: 'failed' }) }] }] } } } })
      }
      state = apply(state, 'first', 'a', 1)
      state = apply(state, 'resume', 'a', 1)
      assert.equal(state.results.length, 1)
      assert.equal(state.results[0].callId, 'resume')
      let next = d.start({}, { event: { data: { turn: 2 } } }, { previous: () => ({ state }) })
      next = apply(next, 'later-resume', 'a', 2)
      assert.equal(next.results.length, 0)
      next = apply(next, 'new-video', 'b', 2)
      assert.equal(next.results.length, 1)
      assert.equal(next.results[0].jobId, 'b')
    }
  } finally { await f.close() }
})

test('failed original card observes a later resume and completion without adding cards', async () => {
  const f = await fixture([{ status: 'failed', job_id: 'a' }, { status: 'running', job_id: 'a', stage: 'reconnecting' },
    { status: 'succeeded', job_id: 'a', comfyui_view_url: 'https://pod.test/view?filename=final.mp4' }])
  try {
    await f.tick()
    assert.match(JSON.stringify(f.view.toJSON()), /正在重试原视频/)
    await f.tick()
    assert.equal(f.view.root.findAllByType('section').length, 1)
    assert.equal(f.view.root.findAllByType('video').length, 1)
    assert.equal(f.timers.size, 0)
    assert.ok(f.requests.every(r => r.url.includes('/status?')))
  } finally { await f.close() }
})
