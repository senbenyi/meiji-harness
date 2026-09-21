import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, utimes, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { withConfig } from '../src/config.js'
import { createDirectorStore } from '../src/server/directors/service.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/server/routes/projects.js'
import { createMediaHandler } from '../src/server/routes/media.js'
import { listAssets } from '../src/server/media/catalog.js'
import { jobSummary } from '../src/worker/results/summary.js'

test('job status exposes the actual model instead of presenting the provider as a model', () => {
  const summary = jobSummary({ status: 'running', debug: { effective_input: { mode: 't2va' } },
    server: { server_id: 'bailian', provider: 'bailian', connection: { text_model: 'wan2.6-t2v', image_model: 'wan2.6-i2v' } } })
  assert.deepEqual(summary.server, { server_id: 'bailian', provider: 'bailian', model: 'wan2.6-t2v' })
})

test('assets require authentication, paginate successful jobs by mtime and accept validated job identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-assets-'))
  const handler = createMediaHandler({ token: 'secret' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media`
  try {
    assert.deepEqual(await (await fetch(base + '/list?t=secret')).json(), { items: [], total: 0, has_more: false })
    const project = '20260910143023456'
    for (let i = 1; i <= 3; i++) {
      const id = String(i).repeat(32), path = join(root, 'projects', 'jobs', id, 'status.json')
      await mkdir(join(root, 'projects', 'jobs', id, 'input'), { recursive: true })
      await writeFile(join(root, 'projects', 'jobs', id, 'input/request.json'), '{}')
      await writeFile(path, JSON.stringify({ job_id: id, project_id: project, debug: { effective_input: { prompt: i === 1 ? '林在咖啡馆' : '雨夜街道', secret: 'not-exported' } }, status: i === 3 ? 'running' : 'succeeded', result: { profile: i === 1 ? 'preview' : 'hd', media_kind: i === 1 ? 'image' : 'video', comfyui_view_url: 'https://model.test/view' } }))
      await utimes(path, i, i)
    }
    assert.equal((await fetch(base + '/list')).status, 401)
    const first = await (await fetch(base + '/list?t=secret&limit=1')).json()
    assert.equal(first.total, 2); assert.equal(first.has_more, true)
    assert.equal(first.items[0].job_id, '2'.repeat(32)); assert.equal(first.items[0].created_at, 2000)
    assert.equal(first.items[0].project_id, project)
    assert.equal(first.items[0].profile, 'hd')
    const catalogPath = join(root, 'pools', 'materials.json')
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
    assert.equal(catalog.version, 1)
    assert.deepEqual(catalog.materials.map(item => item.job_id).sort(), ['1'.repeat(32), '2'.repeat(32)])
    assert.ok(catalog.materials.every(item => item.source === 'creation' && item.project_id === project && !item.deleted))
    assert.equal((await (await fetch(base + '/list?t=secret&source=creation&limit=1')).json()).total, 2)
    assert.equal((await (await fetch(base + '/list?t=secret&source=import')).json()).total, 0)
    await mkdir(join(root, 'projects', project), { recursive: true })
    await writeFile(join(root, 'projects', project, 'materials.json'), JSON.stringify(['1'.repeat(32)]))
    const linked = await (await fetch(base + '/list?t=secret&source=project&limit=1')).json()
    assert.equal(linked.total, 1); assert.equal(linked.items[0].job_id, '1'.repeat(32)); assert.equal(linked.has_more, false)
    assert.equal((await fetch(base + '/list?t=secret&source=bad')).status, 400)
    assert.equal((await (await fetch(base + '/list?t=secret&profile=high-quality')).json()).total, 1)
    const filtered = await (await fetch(base + '/list?t=secret&profile=preview&media_kind=image&limit=1')).json()
    assert.equal(filtered.total, 1); assert.equal(filtered.items[0].job_id, '1'.repeat(32)); assert.equal(filtered.has_more, false)
    assert.equal((await fetch(base + '/list?t=secret&profile=bad')).status, 400)
    const search = await (await fetch(base + '/list?t=secret&q=' + encodeURIComponent('咖啡') + '&limit=1')).json()
    assert.equal(search.total, 1)
    assert.equal(search.items[0].prompt_excerpt, '林在咖啡馆')
    assert.equal(search.items[0].debug, undefined)
    assert.equal((await fetch(base + '/list?t=secret&q=' + 'a'.repeat(201))).status, 400)
    const second = await (await fetch(base + '/list?t=secret&limit=1&offset=1')).json()
    assert.equal(second.items[0].job_id, '1'.repeat(32)); assert.equal(second.has_more, false)
    assert.equal((await fetch(base + '/list?t=secret&offset=-1')).status, 400)
    assert.equal((await fetch(base + '/status?t=secret&job=../bad')).status, 400)
    assert.equal((await (await fetch(base + '/status?t=secret&job=' + '1'.repeat(32))).json()).status, 'succeeded')
    const deleteUrl = base + '/delete?t=secret&job=' + '1'.repeat(32)
    const statusPath = join(root, 'projects', 'jobs', '1'.repeat(32), 'status.json')
    const before = await readFile(statusPath, 'utf8')
    assert.equal((await fetch(deleteUrl.replace('t=secret', 't=bad'), { method: 'POST' })).status, 401)
    assert.equal((await fetch(deleteUrl)).status, 405)
    assert.equal((await fetch(base + '/delete?t=secret&job=../bad', { method: 'POST' })).status, 400)
    assert.equal((await fetch(base + '/delete?t=secret&job=' + '3'.repeat(32), { method: 'POST' })).status, 400)
    assert.equal((await fetch(base + '/delete?t=secret&job=' + '4'.repeat(32), { method: 'POST' })).status, 404)
    assert.equal((await fetch(deleteUrl, { method: 'POST' })).status, 200)
    assert.equal((await fetch(deleteUrl, { method: 'POST' })).status, 200)
    const remaining = await (await fetch(base + '/list?t=secret&limit=1')).json()
    assert.equal(remaining.total, 1); assert.equal(remaining.has_more, false)
    assert.equal(remaining.items[0].job_id, '2'.repeat(32))
    assert.equal((await (await fetch(base + '/list?t=secret&profile=preview')).json()).total, 0)
    assert.equal(JSON.parse(await readFile(catalogPath, 'utf8')).materials.find(item => item.job_id === '1'.repeat(32)).deleted, true)
    await assert.rejects(readFile(join(root, 'projects', 'jobs', '1'.repeat(32), 'asset-deleted.json')), error => error.code === 'ENOENT')
    assert.equal(await readFile(statusPath, 'utf8'), before)
    assert.equal(await readFile(join(root, 'projects', 'jobs', '1'.repeat(32), 'input/request.json'), 'utf8'), '{}')
    assert.equal((await (await fetch(base + '/status?t=secret&job=' + '1'.repeat(32))).json()).has_image, true)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})


test('uploaded images and videos preview locally, persist, delete and only images become anchors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-upload-'))
  const director = await withConfig({ ELYSIUM_STATE_ROOT: root }, () => createDirectorStore().create({ display_name: '姜文' }))
  const media = createMediaHandler({ token: 't' }), projects = createProjectHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => req.url.startsWith(PROJECT_ROUTE) ? projects(req, res) : media(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/plugins/dsh-elysium/media'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64')
  const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
  const upload = (filename, body) => fetch(base + '/upload?t=t&filename=' + encodeURIComponent(filename), { method: 'POST', body })
  const projectRequest = (action, body) => fetch(origin + PROJECT_ROUTE + '/' + action + '?t=t', { method: 'POST', body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(base + '/upload?filename=a.png', { method: 'POST', body: png })).status, 401)
    assert.equal((await fetch(base + '/upload?t=t&filename=a.png')).status, 405)
    assert.equal((await upload('a.txt', png)).status, 400)
    assert.equal((await upload('a.png', mp4)).status, 400)
    assert.equal((await upload('empty.png', Buffer.alloc(0))).status, 400)
    const response = await upload('参考图.png', png)
    assert.equal(response.status, 201)
    const image = await response.json(), video = await (await upload('视频.mp4', mp4)).json()
    assert.equal(image.has_image, true); assert.equal(video.has_video, true)
    assert.equal(image.title, '参考图.png')
    for (const [asset, kind, bytes, mime] of [[image, 'image', png, 'image/png'], [video, 'video', mp4, 'video/mp4']]) {
      const preview = await fetch(base + '/' + kind + '?t=t&job=' + asset.job_id)
      assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), mime)
      assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes)
      const download = await fetch(base + '/download?t=t&job=' + asset.job_id)
      assert.equal(download.status, 200); assert.ok(download.headers.get('content-disposition').startsWith('attachment'))
    }
    const range = await fetch(base + '/video?t=t&job=' + video.job_id, { headers: { Range: 'bytes=0-7' } })
    assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), mp4.subarray(0, 8))
    const list = await (await fetch(base + '/list?t=t')).json()
    assert.equal(list.total, 2)
    assert.equal((await (await fetch(base + '/list?t=t&media_kind=image')).json()).total, 1)
    assert.equal((await (await fetch(base + '/list?t=t&q=' + encodeURIComponent('参考图'))).json()).total, 1)
    assert.deepEqual((await readdir(join(root, 'uploads'))).sort(), [image.job_id, video.job_id].sort())
    const catalogPath = join(root, 'pools', 'materials.json')
    const imported = JSON.parse(await readFile(catalogPath, 'utf8')).materials
    assert.deepEqual(imported.map(item => item.job_id).sort(), [image.job_id, video.job_id].sort())
    assert.ok(imported.every(item => item.source === 'import' && !item.deleted && item.project_id === undefined))
    const project = await (await projectRequest('create', { title: '图片锚点', director: director.name, profile: 'preview', cover_job_id: image.job_id })).json()
    const inserted = await projectRequest('import', { id: project.id, as: 'anchor', job_id: image.job_id })
    assert.equal(inserted.status, 200)
    const anchor = (await inserted.json()).anchors[0]
    assert.equal(anchor.source.job_id, image.job_id); assert.equal(anchor.image_url, '')
    assert.equal((await (await fetch(base + '/list?t=t&source=creation')).json()).total, 0)
    assert.equal((await (await fetch(base + '/list?t=t&source=import')).json()).total, 2)
    const linked = await (await fetch(base + '/list?t=t&source=project')).json()
    assert.equal(linked.total, 1); assert.equal(linked.items[0].job_id, image.job_id)
    assert.equal((await projectRequest('import', { id: project.id, as: 'anchor', job_id: video.job_id, role: anchor.role })).status, 400)
    assert.equal((await fetch(base + '/delete?t=t&job=' + image.job_id, { method: 'POST' })).status, 200)
    assert.equal((await (await fetch(base + '/list?t=t')).json()).total, 1)
    assert.equal(JSON.parse(await readFile(catalogPath, 'utf8')).materials.find(item => item.job_id === image.job_id).deleted, true)
    assert.equal((await fetch(base + '/image?t=t&job=' + image.job_id)).status, 200)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('legacy per-job deletion markers migrate into the global material catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-assets-legacy-delete-'))
  const project = 'a'.repeat(8), job = '1'.repeat(32)
  const directory = join(root, 'projects', 'jobs', job)
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'status.json'), JSON.stringify({ job_id: job, project_id: project, status: 'succeeded', result: { media_kind: 'image', comfyui_view_url: 'https://model.test/view' } }))
    await writeFile(join(directory, 'asset-deleted.json'), '{}')
    const result = await withConfig({ ELYSIUM_STATE_ROOT: root }, () => listAssets(0, 50))
    assert.equal(result.total, 0)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'pools', 'materials.json'), 'utf8')), {
      version: 1, materials: [{ job_id: job, source: 'creation', project_id: project, deleted: true }],
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
