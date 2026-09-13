// 职责：验证登记后的同源媒体读取、范围响应与文件系统边界。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createMediaHandler, MEDIA_ROUTE } from '../src/http/media-routes.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'elysium-local-')), id = 'a'.repeat(32), projectId = 'b'.repeat(8)
  const project = join(root, 'projects', projectId)
  const job = { job_id: id, project_id: projectId, status: 'succeeded', result: { media_kind: 'video', local_media_path: 'media/clip.mp4', comfyui_view_url: 'https://invalid.example/video' } }
  await mkdir(join(project, 'media'), { recursive: true })
  const records = ['clip.mp4', 'image.png', 'subtitles.srt'].map(name => ({ path: `media/${name}`, job_id: id, size_bytes: 10 }))
  for (const record of records) await writeFile(join(project, record.path), '0123456789')
  const save = () => writeFile(join(project, 'media/manifest.json'), JSON.stringify({ project_id: projectId, files: records }))
  await save()
  const handler = createMediaHandler({ token: 'test', readJob: async () => job })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const url = kind => `http://127.0.0.1:${server.address().port}${MEDIA_ROUTE}/${kind}?job=${id}&t=test`
  return { root, project, job, records, save, url, get: (kind, options) => fetch(url(kind), options) }
}

test('local image/video/subtitle GET and HEAD use authenticated routes and prefer local bytes', async t => {
  const f = await fixture(t)
  for (const [file, kind, type, endpoint] of [['image.png', 'image', 'image/png', 'image'], ['clip.mp4', 'video', 'video/mp4', 'video'], ['subtitles.srt', 'file', 'application/x-subrip; charset=utf-8', 'download']]) {
    Object.assign(f.job.result, { local_media_path: `media/${file}`, media_kind: kind })
    const status = await (await f.get('status')).json()
    assert.equal(status.has_download, true)
    assert.equal(status.has_video, kind === 'video'); assert.equal(status.has_image, kind === 'image')
    for (const method of ['GET', 'HEAD']) {
      const res = await f.get(endpoint, { method })
      assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), type)
      assert.equal(res.headers.get('content-length'), '10'); assert.equal(res.headers.get('accept-ranges'), 'bytes')
      assert.equal(await res.text(), method === 'HEAD' ? '' : '0123456789')
    }
    const download = await f.get('download')
    assert.match(download.headers.get('content-disposition'), new RegExp(file.replace('.', '\\.')))
    assert.equal((await fetch(f.url(endpoint).replace('t=test', 't=invalid'))).status, 401)
  }
})

test('local ranges support open/suffix/clamped ranges, HEAD, If-Range and 416', async t => {
  const { get } = await fixture(t)
  for (const [range, body, contentRange] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=8-', '89', 'bytes 8-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-99', '89', 'bytes 8-9/10']]) {
    for (const endpoint of ['video', 'download']) {
      const res = await get(endpoint, { headers: { Range: range } })
      assert.equal(res.status, 206); assert.equal(res.headers.get('content-range'), contentRange)
      assert.equal(res.headers.get('content-length'), String(body.length)); assert.equal(await res.text(), body)
    }
  }
  for (const range of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=999999999999999999999-', 'invalid']) {
    const res = await get('video', { headers: { Range: range } })
    assert.equal(res.status, 416); assert.equal(res.headers.get('content-range'), 'bytes */10'); assert.equal(await res.text(), '')
  }
  const head = await get('video', { method: 'HEAD', headers: { Range: 'bytes=1-3' } })
  assert.equal(head.status, 206); assert.equal(head.headers.get('content-length'), '3'); assert.equal(await head.text(), '')
  assert.equal((await get('video', { headers: { Range: 'bytes=1-3', 'If-Range': '"old"' } })).status, 200)
})

test('local registration rejects traversal, encoded paths, unregistered files and symlink escapes', async t => {
  const f = await fixture(t)
  for (const path of ['/etc/hosts', '../clip.mp4', 'media/test/../../clip.mp4', 'media/test/%2e%2e/clip.mp4', 'media/test/%252e%252e/clip.mp4', 'media/test/a\\clip.mp4', 'file:///etc/hosts', 'media/test/no.mp4']) {
    f.job.result.local_media_path = path
    assert.equal((await f.get('video')).status, 403, path)
    const status = await (await f.get('status')).json()
    assert.equal(status.has_video, false); assert.ok(status.media_error)
  }
  f.job.result.local_media_path = 'media/clip.mp4'
  await rm(join(f.project, 'media/clip.mp4'))
  assert.equal((await f.get('video')).status, 404)
  assert.match((await (await f.get('status')).json()).media_error, /缺失/)
  const outside = await mkdtemp(join(tmpdir(), 'elysium-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'clip.mp4'), '0123456789')
  await symlink(join(outside, 'clip.mp4'), join(f.project, 'media/clip.mp4'))
  assert.equal((await f.get('video')).status, 403)
  await symlink(outside, join(f.project, 'media/escape'))
  f.records.push({ path: 'media/escape/clip.mp4', job_id: f.job.job_id, size_bytes: 10 }); await f.save()
  f.job.result.local_media_path = 'media/escape/clip.mp4'
  assert.equal((await f.get('video')).status, 403)
})
