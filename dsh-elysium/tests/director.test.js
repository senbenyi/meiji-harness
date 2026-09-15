import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createDirectorStore, DEFAULT_DIRECTORS } from '../src/business/directors/store.js'
import { createProjectStore } from '../src/business/projects/store.js'
import { createDirectorHandler, DIRECTOR_ROUTE } from '../src/http/director-routes.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/http/project-routes.js'

test('director catalog seeds JSON, validates entries and protects directors used by projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-directors-'))
  let directorHandler, projectHandler
  withConfig({ ELYSIUM_STATE_ROOT: root }, () => {
    const directors = createDirectorStore()
    const projects = createProjectStore({ newId: () => '1234abcd', directorExists: name => directors.has(name) })
    directorHandler = createDirectorHandler({ token: 't', directorStore: directors, projectStore: projects })
    projectHandler = createProjectHandler({ token: 't', directorStore: directors, projectStore: projects })
  })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => req.url.startsWith(DIRECTOR_ROUTE) ? directorHandler(req, res) : projectHandler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const request = (base, action, body) => fetch(`${origin}${base}/${action}?t=t`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(`${origin}${DIRECTOR_ROUTE}/list`)).status, 401)
    let response = await request(DIRECTOR_ROUTE, 'list')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), DEFAULT_DIRECTORS)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'directors.json'), 'utf8')), DEFAULT_DIRECTORS)

    const custom = { name: '毕赣', style: '梦境、长镜头、诗意现实', works: ['路边野餐', '地球最后的夜晚', '破碎太阳之心', '狂野时代', '金刚经'] }
    response = await request(DIRECTOR_ROUTE, 'create', custom)
    assert.equal(response.status, 201); assert.deepEqual(await response.json(), custom)
    assert.equal((await request(DIRECTOR_ROUTE, 'create', custom)).status, 400)
    response = await request(DIRECTOR_ROUTE, 'create', { ...custom, name: '新导演', works: ['随便写'] })
    assert.equal(response.status, 201); assert.deepEqual((await response.json()).works, ['随便写'])
    response = await request(DIRECTOR_ROUTE, 'create', { ...custom, name: '无作品导演', works: [] })
    assert.equal(response.status, 201); assert.deepEqual((await response.json()).works, [])
    const order = ['无作品导演', ...DEFAULT_DIRECTORS.map(item => item.name), '毕赣', '新导演']
    response = await request(DIRECTOR_ROUTE, 'reorder', { names: order })
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).map(item => item.name), order)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'directors.json'), 'utf8')).map(item => item.name), order)
    assert.equal((await request(DIRECTOR_ROUTE, 'reorder', { names: order.slice(1) })).status, 400)

    assert.equal((await request(PROJECT_ROUTE, 'create', { title: '项目', director: '未知导演', profile: 'preview' })).status, 400)
    assert.equal((await request(PROJECT_ROUTE, 'create', { title: '项目', director: custom.name, profile: 'preview' })).status, 201)
    const edited = { ...custom, style: '新的风格', works: ['新的作品'] }
    response = await request(DIRECTOR_ROUTE, 'update', edited)
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), edited)
    const updated = await request(DIRECTOR_ROUTE, 'list').then(value => value.json())
    assert.deepEqual(updated.find(item => item.name === custom.name), edited)
    assert.deepEqual(updated.map(item => item.name), order)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'directors.json'), 'utf8')), updated)
    assert.equal((await request(DIRECTOR_ROUTE, 'update', { ...edited, style: '' })).status, 400)
    assert.equal((await request(DIRECTOR_ROUTE, 'update', { ...edited, name: '不存在' })).status, 400)
    response = await request(DIRECTOR_ROUTE, 'delete', { name: custom.name })
    assert.equal(response.status, 400); assert.equal((await response.json()).error, '该导演已被项目使用，不能删除')
    response = await request(DIRECTOR_ROUTE, 'delete', { name: '贾樟柯' })
    assert.equal(response.status, 200)
    assert.equal((await request(DIRECTOR_ROUTE, 'list').then(value => value.json())).some(item => item.name === '贾樟柯'), false)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
