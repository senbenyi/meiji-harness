// 职责：验证新的项目 HTTP 文档接口、认证和分集数来源。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createSkillsStore } from '../src/database/managers/skills.js'
import { createDirectorStore } from '../src/database/managers/directors.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProjectHandler } from '../src/server/routes/projects.js'

const template = new URL('../../harness/.dsh/storages/elysium/pools/skills/', import.meta.url)
const series = `一句话故事：一封信\n## 世界观\n旧城\n## 角色\n### 林（主角）\n简介：记者\n定妆：adult man, full body\n音色：低沉\n## 场景\n### 房间\n旧房间\n## 分集\n### 第 1 集 · 来信\n梗概：收到信\n钩子：门响\n### 第 2 集 · 回答\n梗概：解开谜\n钩子：和解\n`
test('project routes write Markdown, expose two episode denominator and reject unauthenticated writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'drama-routes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const skills = createSkillsStore()
    await skills.seed('drama', new URL('drama/', template).pathname)
    await skills.seed('director-cad24a59', new URL('director-cad24a59/', template).pathname)
    const directors = createDirectorStore()
    const store = createProjectStore({ newId: () => '1234abcd', directorExists: name => directors.has(name),
      complete: async ({ name }) => ({ markdown: name === 'drama_series' ? series : '' }) })
    const handler = createProjectHandler({ token: 'test', projectStore: store, directorStore: directors })
    const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => server.close(resolve)))
    const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/project`
    const request = async (action, body, query = '') => fetch(`${base}/${action}?t=test${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    assert.equal((await fetch(`${base}/list`)).status, 401)
    const created = await (await request('create', { title: '来信', director: 'director-cad24a59', genre: '情感', synopsis: '旧信重现' })).json()
    assert.equal(created.title, '来信')
    const response = await request('doc-generate', { id: created.id, step: 'series' })
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    assert.equal((await (await request('list')).json())[0].episode_count, 2)
    const projectPath = join(root, 'projects', created.id)
    assert.match(await readFile(join(projectPath, 'series.md'), 'utf8'), /第 2 集/)
    assert.equal((await request('doc-read', null, `&id=${created.id}&step=series`)).status, 200)
    assert.equal((await request('plan-read', null, `&id=${created.id}`)).status, 404)
  })
})
