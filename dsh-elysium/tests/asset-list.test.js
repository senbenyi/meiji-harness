import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { withConfig } from '../src/config.js'
import { createMediaHandler } from '../src/http/media-routes.js'

test('assets require authentication, paginate successful jobs by mtime and accept validated job identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-assets-'))
  const handler = createMediaHandler({ token: 'secret' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media`
  try {
    assert.deepEqual(await (await fetch(base + '/list?t=secret')).json(), { items: [], total: 0, has_more: false })
    const project = 'a'.repeat(8)
    for (let i = 1; i <= 3; i++) {
      const id = String(i).repeat(32), path = join(root, 'projects', project, 'jobs', id, 'status.json')
      await mkdir(join(root, 'projects', project, 'jobs', id, 'input'), { recursive: true })
      await writeFile(join(root, 'projects', project, 'jobs', id, 'input/request.json'), '{}')
      await writeFile(path, JSON.stringify({ job_id: id, project_id: project, debug: { effective_input: { prompt: i === 1 ? '林在咖啡馆' : '雨夜街道', secret: 'not-exported' } }, status: i === 3 ? 'running' : 'succeeded', result: { profile: i === 1 ? 'preview' : 'hd', media_kind: i === 1 ? 'image' : 'video', comfyui_view_url: 'https://model.test/view' } }))
      await utimes(path, i, i)
    }
    assert.equal((await fetch(base + '/list')).status, 401)
    const first = await (await fetch(base + '/list?t=secret&limit=1')).json()
    assert.equal(first.total, 2); assert.equal(first.has_more, true)
    assert.equal(first.items[0].job_id, '2'.repeat(32)); assert.equal(first.items[0].created_at, 2000)
    assert.equal(first.items[0].profile, 'hd')
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
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
