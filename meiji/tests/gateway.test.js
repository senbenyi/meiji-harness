import test from 'node:test'
import assert from 'node:assert/strict'
import { completeChat, generateGatewayImage, gatewayVideoSize, retrieveGatewayVideo, submitGatewayVideo } from '../server/generate/gateway.js'
import { createTasks } from '../server/flow/tasks/runner.js'
import { checkContext } from '../server/data/operation-context.js'
import { tempHome } from './fixtures/model.js'

const route = { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key' }
const stop = controller => controller.abort(Object.assign(new Error('任务已停止'), { code: 'TASK_CANCELLED' }))
const notCancelled = /网关不提供取消接口，远端视频任务（video_1）可能仍在运行/

test('text-to-image posts documented generations fields and decodes b64_json', async () => {
  const calls = [], bytes = Buffer.from('image bytes')
  const result = await generateGatewayImage({ ...route, prompt: '中文图片', aspectRatio: '768x1344', seed: 42, fetchImpl: async (url, options) => {
    calls.push([url.pathname, options.method])
    assert.equal(options.headers.Authorization, 'Bearer test-key')
    assert.deepEqual(JSON.parse(options.body), { model: 'elysium-image', prompt: '中文图片', size: '768x1344', seed: 42 })
    return Response.json({ created: 1, data: [{ b64_json: bytes.toString('base64') }] })
  } })
  assert.deepEqual(result, bytes)
  assert.deepEqual(calls, [['/v1/images/generations', 'POST']])
  await assert.rejects(generateGatewayImage({ ...route, prompt: '图片', fetchImpl: async () => Response.json({ data: [] }) }), /网关未返回图片/)
})

test('several reference images go to images/edits in order as image[] files', async () => {
  const first = Buffer.from('first'), second = Buffer.from('second')
  let form
  await generateGatewayImage({ ...route, prompt: '合成', aspectRatio: '1344x768', seed: 1, references: [{ bytes: first, mime: 'image/png' }, { bytes: second, mime: 'image/jpeg' }], fetchImpl: async (url, options) => {
    assert.equal(url.pathname, '/v1/images/edits')
    form = options.body
    return Response.json({ data: [{ b64_json: 'AA==' }] })
  } })
  assert.deepEqual([...form.keys()], ['model', 'prompt', 'size', 'image[]', 'image[]'])
  const files = form.getAll('image[]')
  assert.deepEqual(await Promise.all(files.map(async file => Buffer.from(await file.arrayBuffer()).toString())), ['first', 'second'])
  assert.deepEqual(files.map(file => file.type), ['image/png', 'image/jpeg'])
  await assert.rejects(generateGatewayImage({ ...route, prompt: '太多', references: Array.from({ length: 11 }, () => ({ bytes: first, mime: 'image/png' })), fetchImpl: async () => assert.fail('不能提交') }), /最多 10 张/)
})

test('video size follows the project aspect ratio within the gateway pixel budget', () => {
  assert.equal(gatewayVideoSize('1344x768'), '1024x576')
  assert.equal(gatewayVideoSize('768x1344'), '576x1024')
  for (const size of ['1024x576', '576x1024']) {
    const [w, h] = size.split('x').map(Number)
    assert.ok(w % 32 === 0 && h % 32 === 0 && w * h <= 864 * 1184)
  }
})

test('stopping video polling sends no cancel request and reports the remote task honestly', async () => {
  const controller = new AbortController(), calls = []
  await assert.rejects(retrieveGatewayVideo({ ...route, promptId: 'video_1', signal: controller.signal, pause: async () => stop(controller), fetchImpl: async (url, options) => {
    calls.push([url.pathname, options.method])
    return Response.json({ status: 'in_progress' })
  } }), error => error.code === 'REMOTE_NOT_CANCELLED' && notCancelled.test(error.message))
  assert.deepEqual(calls, [['/v1/videos/video_1', 'GET']])
})

test('stop during video submission waits for the ID, then reports it without cancelling', async () => {
  const controller = new AbortController(), calls = []
  await assert.rejects(submitGatewayVideo({ ...route, prompt: '视频', signal: controller.signal, fetchImpl: async (url, options) => {
    calls.push(url.pathname)
    stop(controller)
    assert.equal(options.signal.aborted, false)
    return Response.json({ id: 'video_1', status: 'queued' })
  } }), notCancelled)
  assert.deepEqual(calls, ['/v1/videos'])
})

test('stopping a synchronous image request aborts it', async () => {
  const controller = new AbortController()
  await assert.rejects(generateGatewayImage({ ...route, prompt: '图片', signal: controller.signal, fetchImpl: (_url, options) => {
    stop(controller)
    assert.equal(options.signal.aborted, true)
    return Promise.reject(options.signal.reason)
  } }), { code: 'TASK_CANCELLED' })
})

test('panel stop ends the task without any cancel request', async t => {
  const query = Promise.withResolvers(), calls = []
  const tasks = createTasks({ home: await tempHome(t), execute: async (_, { signal }) => {
    await retrieveGatewayVideo({ ...route, promptId: 'video_1', signal, fetchImpl: async (url, options) => {
      calls.push(url.pathname)
      query.resolve()
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    } })
    return []
  } })
  const task = tasks.start({ projectId: 'p', episodeId: 'e', action: 'film', track: 'S01' })
  await query.promise
  tasks.cancel(task.id, 'p')
  tasks.cancel(task.id, 'p')
  await task.done
  assert.deepEqual(calls, ['/v1/videos/video_1'])
  assert.deepEqual(tasks.list('p'), [])
})

// 服务关闭一律取消本地任务：网关不提供取消接口，不发送任何取消请求。
test('service shutdown cancels the local task and sends no remote cancel', async t => {
  const paused = Promise.withResolvers(), calls = []
  const tasks = createTasks({ home: await tempHome(t), execute: async (_operation, { signal }) => {
    await retrieveGatewayVideo({ ...route, promptId: 'video_1', signal, pause: (_ms, polling) => { paused.resolve(); return new Promise((_, reject) => polling.addEventListener('abort', () => reject(polling.reason), { once: true })) }, fetchImpl: async (url, options) => {
      calls.push([url.pathname, options.method])
      return Response.json({ status: 'in_progress' })
    } })
  } })
  const { done } = tasks.start({ action: 'film', projectId: 'p', episodeId: 'e', track: 'S01', sessionId: 's' })
  await paused.promise
  tasks.dispose()
  const result = await done
  assert.equal(result.status, 'cancelled')
  assert.deepEqual(calls, [['/v1/videos/video_1', 'GET']])
})

test('stop after completion prevents downloading', async () => {
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
  test(`${action}: stopping records the uncancelled remote video and releases the card`, async t => {
    const { setupModel } = await import('./fixtures/model.js')
    const { modelStore } = await import('../server/data/model-settings.js')
    const { runOperation } = await import('../server/flow/operations/run.js')
    const e = await setupModel(t), controller = new AbortController()
    await modelStore(e.home).write({ ...route, chat: { model: 'chat' }, story: { model: 'chat' }, image: { model: 'image' }, video: { model: 'video' } })
    let submissions = 0
    const paths = []
    const execution = runOperation(e.op(action, action === 'film' ? { track: 'S01' } : {}), {
      home: e.home, signal: controller.signal, waitForBackground: true,
      submitH3: async () => { submissions++; return { ...route, shots: [{ promptId: 'video_1', duration: 5 }] } },
      retrieveFilm: options => retrieveGatewayVideo({ ...options, pause: async () => stop(controller), fetchImpl: async url => {
        paths.push(url.pathname)
        return Response.json({ status: 'in_progress' })
      } }),
    })
    if (action === 'film') await execution
    else await assert.rejects(execution, { code: 'REMOTE_NOT_CANCELLED' })
    const video = (await e.read()).shots.items[0].video
    assert.equal(video.content.promptId, 'video_1')
    assert.equal(video.content.status, 'error')
    assert.match(video.content.error, notCancelled)
    assert.equal(video.operation, null)
    assert.equal(video.status, 'failed')
    assert.equal(submissions, 1)
    assert.ok(paths.every(path => !path.endsWith('/cancel')))
  })
}

test('JSON mode is explicit and truncated responses fail before parsing or retrying', async () => {
  let calls = 0
  await assert.rejects(completeChat({ baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', prompt: 'JSON', json: true, fetchImpl: async (_url, options) => {
    calls++
    assert.deepEqual(JSON.parse(options.body).response_format, { type: 'json_object' })
    return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{' } }] })
  } }), { code: 'INCOMPLETE_MODEL_OUTPUT' })
  assert.equal(calls, 1)
})
