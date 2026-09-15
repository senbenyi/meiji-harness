// 职责：验证切换默认服务器后任务、原子查询与媒体引用不会串用。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createJob } from '../src/jobs/create.js'
import { readJson, saveJson } from '../src/jobs/store.js'
import { readBackend } from '../src/servers/backend.js'
import { withBackend, resolveServer } from '../src/servers/resolve.js'
import { writeRegistry, readRegistry } from '../src/servers/store.js'
import { executeComfyVideo } from '../src/video/execution.js'
import { createComfyuiTaskStatusTool, createComfyuiTaskCancelTool } from '../src/tools/comfyui-tasks.js'
import { mediaReference } from '../src/comfyui/media-reference.js'
import { createMediaHandler, MEDIA_ROUTE } from '../src/http/media-routes.js'
import { launch } from '../src/video/launcher.js'
import { jobSummary } from '../src/assets/catalog.js'

test('A task survives a default switch to B even when preparation failed; identical prompt IDs remain scoped', async t => {
  const root = await mkdtemp(join(tmpdir(), 'binding-')), requests = { a: [], b: [] }
  const servers = []
  for (const id of ['a', 'b']) {
    const server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk
      requests[id].push([req.url, body])
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(req.url === '/queue' ? { queue_pending: [[0, 'same']] } : req.url === '/history/same' ? { same: { status: { status_str: id } } } : {}))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    servers.push({ id, label: id, provider: 'manual', instance_id: id, deployment_id: 'one', connection_source: 'manual', services: { comfyui: { transport: 'http', base_url: `http://127.0.0.1:${server.address().port}`, workload: 'minimax-h3' } } })
    t.after(() => new Promise(resolve => server.close(resolve)))
  }
  t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_STATE_ROOT: root, ELYSIUM_SERVERS_FILE: join(root, 'servers.json') }, async () => {
    const registry = await writeRegistry({ version: 1, revision: 0, active: { comfyui: 'a' }, servers }, 0)
    const project = 'abcd1234', plan = { mode: 't2va', prompt: 'A scene' }
    await saveJson(join(root, 'projects', project, 'project.json'), {})
    const id = await createJob(project, plan), dir = join(root, 'projects', project, 'jobs', id)
    await assert.rejects(executeComfyVideo(project, id, plan), /缺少节点/)
    assert.equal(await readJson(join(dir, 'comfyui-workflow.json')), null)
    await writeRegistry({ ...registry, active: { comfyui: 'b' } }, 1)
    requests.a.length = 0
    await assert.rejects(executeComfyVideo(project, id, plan), /缺少节点/)
    assert.ok(requests.a.length > 0); assert.equal(requests.b.length, 0)
    assert.equal((await readBackend(dir)).server_id, 'a')
    const next = await createJob(project, plan)
    assert.equal((await readBackend(join(root, 'projects', project, 'jobs', next))).server_id, 'b')
    await createComfyuiTaskStatusTool().execute({ server: 'a', prompt_id: 'same' })
    await createComfyuiTaskCancelTool().execute({ server: 'a', prompt_id: 'same' })
    assert.ok(requests.a.some(([path, body]) => path === '/queue' && body.includes('same')))
    assert.equal(requests.b.length, 0)
    await assert.rejects(createComfyuiTaskStatusTool().execute({ server: 'minimax-h3', prompt_id: 'same' }), /未配置/)
    const media = `${servers[0].services.comfyui.base_url}/view?filename=same.mp4&type=output`
    assert.throws(() => withBackend(resolveServer(), () => mediaReference(media)), /属于/)
    assert.equal(jobSummary({ status: 'succeeded', result: { comfyui_view_url: media } }).comfyui_view_url, media)
    const mediaJob = { job_id: id, status: 'succeeded', server: await readBackend(dir), result: { comfyui_view_url: media } }
    const proxy = createServer(createMediaHandler({ token: 'test', readJob: async () => mediaJob }))
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => proxy.close(resolve)))
    const mediaEndpoint = `http://127.0.0.1:${proxy.address().port}${MEDIA_ROUTE}/video?t=test&job=${id}`
    const response = await fetch(mediaEndpoint); assert.equal(response.status, 200); await response.text()
    assert.ok(requests.a.some(([path]) => path.startsWith('/view?')))
    assert.equal(requests.b.length, 0)
    mediaJob.result.comfyui_view_url = `${servers[1].services.comfyui.base_url}/view?filename=same.mp4&type=output`
    assert.equal((await fetch(mediaEndpoint)).status, 403)
    assert.equal(requests.b.length, 0)
    const unknownId = 'f'.repeat(32), unknownJob = join(root, 'projects', project, 'jobs', unknownId)
    await saveJson(join(unknownJob, 'input/request.json'), plan)
    await assert.rejects(launch(unknownId), /缺失/)
    const unknown = join(root, 'unknown')
    await assert.rejects(readBackend(unknown), /缺失/)
    await saveJson(join(unknown, 'comfyui-workflow.json'), { server_url: 'http://a.test/' })
    assert.equal((await readBackend(unknown)).base_url, 'http://a.test')
    await saveJson(join(unknown, 'comfyui-submission.json'), { server_url: 'http://b.test/' })
    await assert.rejects(readBackend(unknown), /冲突/)
    assert.equal(readRegistry().active.comfyui, 'b')
  })
})
