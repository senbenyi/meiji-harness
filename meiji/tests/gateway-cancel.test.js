import test from 'node:test'
import assert from 'node:assert/strict'
import { generateGatewayImage, retrieveGatewayVideo, submitGatewayVideo } from '../server/generate/gateway.js'
import { createPanelTasks } from '../server/flow/panel-tasks.js'
import { checkContext } from '../server/data/self-checks.js'

const route = { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key' }
const stop = controller => controller.abort(Object.assign(new Error('任务已停止'), { code: 'TASK_CANCELLED' }))

for (const kind of ['videos', 'images/tasks']) {
  test(`${kind}: stopping polling sends one authenticated cancel with an independent signal`, async () => {
    const controller = new AbortController(), calls = []
    const fetchImpl = async (url, options) => {
      calls.push([url.pathname, options.method])
      assert.equal(options.headers.Authorization, 'Bearer test-key')
      if (url.pathname.endsWith('/cancel')) {
        assert.equal(options.signal.aborted, false)
        assert.equal(options.body, undefined)
        return Response.json({ status: 'cancelled' })
      }
      if (options.method === 'POST') return Response.json({ id: 'image_1', status: 'queued' })
      return Response.json({ status: 'in_progress' })
    }
    const options = { ...route, signal: controller.signal, fetchImpl, pause: async () => stop(controller) }
    await assert.rejects(kind === 'videos' ? retrieveGatewayVideo({ ...options, promptId: 'video_1' }) : generateGatewayImage({ ...options, prompt: '人物' }), {
      code: kind === 'videos' ? 'VIDEO_TASK_TERMINAL' : 'IMAGE_TASK_TERMINAL',
    })
    assert.deepEqual(calls, kind === 'videos'
      ? [['/v1/videos/video_1', 'GET'], ['/v1/videos/video_1/cancel', 'POST']]
      : [['/v1/images/tasks', 'POST'], ['/v1/images/tasks/image_1', 'GET'], ['/v1/images/tasks/image_1/cancel', 'POST']])
  })

  test(`${kind}: stop during submission waits for the ID then cancels without polling`, async () => {
    const controller = new AbortController(), calls = []
    const fetchImpl = async (url, options) => {
      calls.push(url.pathname)
      if (url.pathname.endsWith('/cancel')) {
        assert.equal(options.signal.aborted, false)
        return Response.json({ status: 'cancelled' })
      }
      stop(controller)
      assert.equal(options.signal.aborted, false)
      return Response.json({ id: 'job_1', status: 'queued' })
    }
    await assert.rejects(kind === 'videos'
      ? submitGatewayVideo({ ...route, fetchImpl, signal: controller.signal, prompt: '视频' })
      : generateGatewayImage({ ...route, fetchImpl, signal: controller.signal, prompt: '图片' }), /远端任务已终止/)
    assert.deepEqual(calls, [`/v1/${kind}`, `/v1/${kind}/job_1/cancel`])
  })
}

test('panel stop waits for remote cancellation; repeated clicks do not duplicate requests', async () => {
  const query = Promise.withResolvers(), cancellation = Promise.withResolvers(), reachedCancel = Promise.withResolvers()
  let cancelCount = 0
  const tasks = createPanelTasks({ home: '/tmp/meiji-cancel-test', execute: async (_, { signal }) => {
    await retrieveGatewayVideo({ ...route, promptId: 'video_1', signal, fetchImpl: async (url, options) => {
      if (url.pathname.endsWith('/cancel')) { cancelCount++; reachedCancel.resolve(); return cancellation.promise }
      query.resolve()
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    } })
    return []
  } })
  const task = tasks.start({ projectId: 'p', episodeId: 'e', action: 'film', track: 'S01' })
  await query.promise
  tasks.cancel(task.id, 'p')
  tasks.cancel(task.id, 'p')
  await reachedCancel.promise
  assert.equal(tasks.list('p').length, 1)
  cancellation.resolve(Response.json({ status: 'cancelled' }))
  await task.done
  assert.equal(cancelCount, 1)
  assert.deepEqual(tasks.list('p'), [])
})

test('unsupported remote cancellation is reported rather than claiming success', async () => {
  const controller = new AbortController()
  stop(controller)
  await assert.rejects(retrieveGatewayVideo({ ...route, promptId: 'video_1', signal: controller.signal,
    fetchImpl: async () => Response.json({ error: { message: 'channel does not support cancellation' } }, { status: 501 }),
  }), error => error.code === 'REMOTE_CANCEL_FAILED' && /video_1.*channel does not support cancellation.*仍在运行/.test(error.message))
})

test('service pause keeps the submitted video available for resuming', async () => {
  const controller = new AbortController(), reason = Object.assign(new Error('暂停'), { code: 'TASK_PAUSED' })
  let calls = 0
  controller.abort(reason)
  await assert.rejects(retrieveGatewayVideo({ ...route, promptId: 'video_1', signal: controller.signal, fetchImpl: async () => { calls++ } }), error => error === reason)
  assert.equal(calls, 0)
})

test('completed image is downloaded as bytes using the documented task endpoints', async () => {
  const calls = [], bytes = Buffer.from('image bytes')
  const result = await generateGatewayImage({ ...route, prompt: '中文图片', aspectRatio: '768x1344', fetchImpl: async (url, options) => {
    calls.push([url.pathname, options.method])
    if (options.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), { model: 'elysium-image', prompt: '中文图片', size: '768x1344' })
      return Response.json({ id: 'image_1', status: 'queued' })
    }
    if (url.pathname.endsWith('/content')) return new Response(bytes)
    return Response.json({ status: 'completed' })
  } })
  assert.deepEqual(result, bytes)
  assert.deepEqual(calls, [['/v1/images/tasks', 'POST'], ['/v1/images/tasks/image_1', 'GET'], ['/v1/images/tasks/image_1/content', 'GET']])
})

test('stop after completion prevents downloading without cancelling a completed job', async () => {
  const controller = new AbortController(), paths = []
  await assert.rejects(retrieveGatewayVideo({ ...route, signal: controller.signal, promptId: 'video_1', fetchImpl: async url => {
    paths.push(url.pathname)
    stop(controller)
    return Response.json({ status: 'completed' })
  } }), { code: 'TASK_CANCELLED' })
  assert.deepEqual(paths, ['/v1/videos/video_1'])
})

test('generation uses the operation context signal and does not submit after stop', async () => {
  const controller = new AbortController()
  stop(controller)
  await checkContext.run({ signal: controller.signal }, async () => {
    const fetchImpl = async () => assert.fail('must not submit')
    await assert.rejects(generateGatewayImage({ ...route, fetchImpl }), { code: 'TASK_CANCELLED' })
    await assert.rejects(submitGatewayVideo({ ...route, fetchImpl }), { code: 'TASK_CANCELLED' })
  })
})

for (const action of ['film', 'films']) {
  test(`${action}: remote cancellation persists a terminal video and releases the card`, async t => {
    const { setupModel } = await import('./fixtures/model.js')
    const { modelStore } = await import('../server/data/models.js')
    const { runOperation } = await import('../server/flow/actions.js')
    const e = await setupModel(t), controller = new AbortController()
    await modelStore(e.home).write({ ...route, chat: { model: 'chat' }, story: { model: 'chat' }, image: { model: 'image' }, video: { model: 'video' } })
    let submissions = 0, cancellations = 0
    const execution = runOperation(e.op(action, action === 'film' ? { track: 'S01' } : {}), {
      home: e.home, signal: controller.signal, waitForBackground: true,
      submitH3: async () => { submissions++; return { ...route, shots: [{ promptId: 'video_1', duration: 5 }] } },
      retrieveFilm: options => retrieveGatewayVideo({ ...options, pause: async () => stop(controller), fetchImpl: async url => {
        if (url.pathname.endsWith('/cancel')) { cancellations++; return Response.json({ status: 'cancelled' }) }
        return Response.json({ status: 'in_progress' })
      } }),
    })
    if (action === 'film') await execution
    else await assert.rejects(execution, { code: 'VIDEO_TASK_TERMINAL' })
    const video = (await e.read()).shots.items[0].video
    assert.equal(video.content.promptId, 'video_1')
    assert.equal(video.content.terminal, true)
    assert.equal(video.content.status, 'error')
    assert.equal(video.operation, null)
    assert.equal(video.status, 'failed')
    assert.equal(submissions, 1)
    assert.equal(cancellations, 1)
  })
}
