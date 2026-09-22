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
    const script = '## 场 1｜房间｜林\n动作：林走到窗边。'
    assert.equal((await request('doc-save', { id: created.id, step: 'script', episode: 1, markdown: script })).status, 200)
    const rejected = await request('doc-save', { id: created.id, step: 'script', episode: 1, markdown: script.replace('｜房间｜', '｜房间窗边｜') })
    assert.equal(rejected.status, 400)
    assert.match((await rejected.json()).error, /房间窗边.*不在总览/)
    assert.equal(await readFile(join(projectPath, 'episodes/1/script.md'), 'utf8'), script)
    assert.equal((await request('plan-read', null, `&id=${created.id}`)).status, 404)
  })
})

test('generation corrects invalid references and missing scene boundaries before saving', async t => {
  const root = await mkdtemp(join(tmpdir(), 'drama-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const skills = createSkillsStore()
    for (const name of ['drama', 'director-cad24a59']) await skills.seed(name, new URL(name + '/', template).pathname)
    const script = '## 场 1｜房间｜林\n动作：林拿起信。\n\n## 场 2｜房间｜林\n动作：林打开信。'
    const block = (n, video = '林看信。') => `### 从第 ${n} 行｜近景｜固定｜5 秒｜人物：林\n视频：${video}\n首帧：A man holding a letter.`
    const prompts = []; let mode = 'script'
    const store = createProjectStore({ newId: () => '1234abcd', complete: async prompt => {
      const input = JSON.parse(prompt.user); prompts.push(input)
      if (mode === 'script') return { markdown: input.correction ? script : script.replace('｜房间｜', '｜房间窗边｜') }
      if (mode === 'fail') return { markdown: script.replace('｜房间｜', '｜不存在｜') }
      if (mode === 'single') { assert.equal(input.target_shot.id, 'S02'); assert.match(input.numbered_lines, /^2\./); assert.doesNotMatch(input.numbered_lines, /拿起/); return { markdown: input.correction ? block(2, '林把信折好。') : block(1) } }
      assert.deepEqual(input.scenes.map(scene => scene.first_line), [1, 2])
      return { markdown: input.correction ? block(1) + '\n' + block(2) : block(1) }
    } })
    const project = await store.change('create', { title: '来信', director: 'director-cad24a59' })
    await store.saveDoc(project.id, 'series', series)
    await store.planning.generate({ id: project.id, step: 'script', episode: 1 })
    assert.match(prompts[1].correction.error, /房间窗边/)
    assert.equal((await store.read(project.id)).episodes[0].script, script)
    mode = 'fail'; const before = prompts.length
    await assert.rejects(store.planning.generate({ id: project.id, step: 'script', episode: 1 }), /不存在/)
    assert.equal(prompts.length - before, 2)
    assert.equal((await store.read(project.id)).episodes[0].script, script)
    mode = 'storyboard'
    await store.planning.generate({ id: project.id, step: 'storyboard', episode: 1 })
    assert.match(prompts.at(-1).correction.error, /每场首行/)
    let episode = (await store.read(project.id)).episodes[0]
    assert.equal(episode.storyboard_ready, true)
    const first = episode.shots[0].video
    await store.changeShot(project.id, { episode: 1, id: 'S01', take: 1, job_id: 'a'.repeat(32), status: 'succeeded' })
    await store.changeShot(project.id, { episode: 1, id: 'S02', take: 1, job_id: 'b'.repeat(32), status: 'succeeded' })
    mode = 'single'
    await store.planning.generate({ id: project.id, step: 'storyboard', episode: 1, shot_id: 'S02' })
    episode = (await store.read(project.id)).episodes[0]
    assert.equal(episode.shots[0].video, first)
    assert.equal(episode.shots[1].video, '林把信折好。')
    assert.equal(episode.shots[0].job_id, 'a'.repeat(32))
    assert.equal(episode.shots[1].job_id, null)
    assert.equal(episode.shots[1].take, 2)
    await assert.rejects(store.planning.save({ id: project.id, step: 'storyboard', episode: 1, markdown: episode.script.replace('首帧：A man holding a letter.', '首帧：') }), /缺少提示词/)
    await assert.rejects(store.saveDoc(project.id, 'series', series.replace('### 房间', '### 陌生场景')), /不在总览/)
  })
})
