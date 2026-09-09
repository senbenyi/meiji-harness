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
  require(pkg.name).apply({ settingsScope: { bind: () => ({}) }, slots: { inject: (_, run) => run(), register: (spec, component) => {
    if (spec.name === 'tool.call.toolview') slots.push({ spec, component })
  } } })
  assert.deepEqual(slots.map(s => s.spec.key), ['workflow_generate_video', 'workflow_resume_video', 'model_generate_video', 'model_generate_video_long', 'model_generate_image', 'model_concat_video', 'model_job_resume'])
  let view
  await act(async () => { view = create(React.createElement(slots[0].component, { sessionId: 'session', callId: 'call', block })) })
  return { view, requests, timers,
    tick: async () => act(async () => { const [id, run] = timers.entries().next().value; timers.delete(id); await run() }),
    close: async () => act(async () => view.unmount()) }
}

test('same card progresses to playable result and stops polling', async () => {
  const f = await fixture([{ status: 'running', stage: 'generate' }, { status: 'succeeded', has_video: true,
    job_id: 'a', media_info: { duration_seconds: 8, width: 640, height: 384, frame_rate: 24 }, validation: { full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' } }])
  try {
    assert.match(f.view.root.findByProps({ role: 'status' }).children.join(''), /生成视频/)
    assert.equal(f.view.root.findAllByType('video').length, 0)
    assert.equal(f.view.root.findByProps({ role: 'progressbar' }).props['aria-label'], '视频生成中')
    assert.equal(f.view.root.findAllByType('animateTransform').length, 1)
    await f.tick()
    const video = f.view.root.findByType('video')
    assert.equal(f.view.root.findAllByProps({ role: 'progressbar' }).length, 0)
    assert.match(video.props.src, /^\/plugins\/dsh-elysium\/media\/video\?/)
    assert.equal(video.props.controls, false)
    assert.ok(!video.props.src.includes('3080'))
    assert.equal(f.view.root.findAllByType('a').length, 0)
    assert.equal(f.timers.size, 0)
    assert.match(JSON.stringify(f.view.toJSON()), /尚未人工验收/)
    assert.equal(f.requests.length, 2)
  } finally { await f.close() }
})

test('completed card plays below task details without a separate link', async () => {
  const url = 'http://127.0.0.1:6016/api/view?filename=final.mp4&subfolder=elysium/test&type=output&format=video%2Fmp4'
  const f = await fixture([{ status: 'succeeded', has_video: true, comfyui_view_url: url }])
  try {
    assert.equal(f.view.root.findByType('video').props.src, url)
    assert.equal(f.view.root.findAllByType('a').length, 0)
    const children = f.view.root.findByType('section').children
    assert.ok(children.findIndex(child => child.type === 'video') > children.findIndex(child => child.type === 'details'))
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})

test('a completed tool result plays without polling the media service', async () => {
  const url = 'http://127.0.0.1:6016/api/view?filename=final.mp4&type=output'
  const f = await fixture([], { content: [{ type: 'text', text: JSON.stringify({ job_id: 'a', status: 'succeeded', comfyui_view_url: url }) }] })
  try {
    assert.equal(f.view.root.findByType('video').props.src, url)
    assert.equal(f.requests.length, 0)
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})

test('rejected arguments show a compact record without a task card or polling', async () => {
  const f = await fixture([], { isError: true, content: [{ type: 'text', text: 'Error: 短视频一条提示词；长视频至少两条且每段 1..15 秒' }] })
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
test('new shot validation errors do not appear as running jobs', async () => {
  const f = await fixture([], { isError: true, content: [{ type: 'text', text: 'Error: [MODEL_INPUT_INVALID] 镜头时长之和必须等于 duration' }] })
  try {
    assert.equal(f.view.root.findAllByType('section').length, 0)
    assert.equal(f.requests.length, 0)
    assert.equal(f.timers.size, 0)
    assert.match(JSON.stringify(f.view.toJSON()), /未创建任务/)
  } finally { await f.close() }
})
test('per-shot stages identify the current shot without claiming review passed', async () => {
  const f = await fixture([{ status: 'running', stage: 's02:render' }])
  try {
    assert.match(f.view.root.findByProps({ role: 'status' }).children.join(''), /镜头 s02：整理镜头/)
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
    assert.equal(f.timers.size, 0)
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

test('ComfyUI playback failure falls back to same-origin media, then reports failure without looping', async () => {
  const url = 'http://127.0.0.1:6016/view?filename=final.mp4&type=output'
  const f = await fixture([{ status: 'succeeded', has_video: true }], { content: [{ type: 'text', text: JSON.stringify({ job_id: 'a', status: 'succeeded', comfyui_view_url: url }) }] })
  try {
    await act(async () => f.view.root.findByType('video').props.onError())
    const video = f.view.root.findByType('video')
    assert.match(video.props.src, /^\/plugins\/dsh-elysium\/media\/video\?/)
    assert.match(video.props.src, /session=session&call=call/)
    assert.equal(f.view.root.findAllByProps({ role: 'alert' }).length, 0)
    await act(async () => video.props.onError())
    assert.match(JSON.stringify(f.view.toJSON()), /视频加载失败/)
    assert.equal(f.requests.length, 1)
    await act(async () => f.view.root.findByProps({ children: '重试播放' }).props.onClick())
    assert.equal(f.view.root.findByType('video').props.src, url)
    assert.equal(f.view.root.findAllByProps({ role: 'alert' }).length, 0)
  } finally { await f.close() }
})

test('interrupted session recovers original job and falls back when ComfyUI is unreachable', async () => {
  const f = await fixture([{ status: 'succeeded', job_id: 'original', has_video: true,
    comfyui_view_url: 'http://127.0.0.1:6016/view?filename=final.mp4' }],
  { isError: true, content: [{ type: 'text', text: 'The tool call was interrupted; outcome unknown.' }] })
  try {
    assert.match(f.view.root.findByProps({ role: 'status' }).children.join(''), /已完成/)
    await act(async () => f.view.root.findByType('video').props.onError())
    assert.match(f.view.root.findByType('video').props.src, /^\/plugins\/dsh-elysium\/media\/video\?/)
    assert.equal(f.requests.length, 1)
    assert.match(f.requests[0].url, /\/status\?/)
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})

test('image result renders a picture with download and same-origin fallback', async () => {
  const f = await fixture([], { content: [{ type: 'text', text: JSON.stringify({ job_id: 'image', status: 'succeeded', media_kind: 'image', comfyui_view_url: 'http://127.0.0.1:6016/view?filename=final.png', media_info: { width: 832, height: 1216 } }) }] })
  try {
    assert.equal(f.view.root.findAllByType('video').length, 0)
    assert.equal(f.view.root.findByType('img').props.alt, '生成图片')
    assert.match(f.view.root.findByType('a').props.href, /image\?.*download=1/)
    await act(async () => f.view.root.findByType('img').props.onError())
    assert.match(f.view.root.findByType('img').props.src, /^\/plugins\/dsh-elysium\/media\/image\?/)
    assert.ok(!JSON.stringify(f.view.toJSON()).includes('null 秒'))
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

test('portrait video stays a thumbnail and opens a dismissible player', async () => {
  const f = await fixture([{ status: 'succeeded', has_video: true, media_info: { width: 480, height: 854 } }])
  try {
    const thumbnail = f.view.root.findByType('video')
    assert.equal(thumbnail.props.style.maxWidth, 160)
    assert.equal(thumbnail.props.style.maxHeight, 180)
    assert.equal(thumbnail.props.style.objectFit, 'contain')
    await act(async () => thumbnail.props.onClick())
    const modal = f.view.root.findByType('dialog')
    assert.equal(modal.findByType('video').props.controls, true)
    await act(async () => modal.findByType('button').props.onClick())
    assert.equal(f.view.root.findAllByType('dialog').length, 0)
    await act(async () => f.view.root.findByProps({ children: '放大查看' }).props.onClick())
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
