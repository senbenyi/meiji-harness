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
import { generationSchema, validateGenerated } from '../src/server/projects/contracts.js'
import { insertStoryboard, parseProject, parseScript, parseSeries, renderGenerated, validateScript } from '../src/server/projects/documents.js'

const template = new URL('../../harness/.dsh/storages/elysium/pools/skills/', import.meta.url)
const series = `一句话故事：一封信\n## 世界观\n旧城\n## 角色\n### 林（主角）\n简介：记者\n定妆：adult man, full body\n音色：低沉\n## 场景\n### 房间\n旧房间\n## 分集\n### 第 1 集 · 来信\n梗概：收到信\n钩子：门响\n### 第 2 集 · 回答\n梗概：解开谜\n钩子：和解\n`
const seriesResult = { logline: '一封信', world: '旧城', characters: [{ name: '林', lead: true, intro: '记者', appearance: 'adult man, full body', voice: '低沉' }],
  scenes: [{ name: '房间', description: '旧房间' }], episodes: [
    { number: 1, title: '来信', summary: '收到信', hook: '门响' }, { number: 2, title: '回答', summary: '解开谜', hook: '和解' },
  ] }

test('structured contracts render four steps and require a first shot for every scene', () => {
  const project = { title: '来信', genre: '悬疑', synopsis: '旧信重现。' }
  validateGenerated('project', project, {})
  assert.equal(parseProject(renderGenerated('project', project, { director_id: 'director-cad24a59' })).director, 'director-cad24a59')
  const overview = { logline: '一封旧信', world: '旧城', characters: [{ name: '林', lead: true, intro: '记者', appearance: 'adult man, full body', voice: '低沉' }],
    scenes: [{ name: '房间', description: '旧房间' }], episodes: [{ number: 1, title: '来信', summary: '收到信', hook: '门响' }] }
  validateGenerated('series', overview, { expected_episodes: 1 })
  const parsedSeries = parseSeries(renderGenerated('series', overview, {}))
  assert.equal(parsedSeries.episodes.length, 1)
  const scriptValue = { scenes: [
    { number: 1, name: '房间', roles: ['林'], lines: [{ kind: 'action', speaker: '', tone: '', text: '林拿起信。' }] },
    { number: 2, name: '房间', roles: ['林'], lines: [{ kind: 'sound', speaker: '', tone: '', text: '门铃响。' }, { kind: 'dialogue', speaker: '林', tone: '低声', text: '谁来了？' }] },
  ] }
  validateGenerated('script', scriptValue, { series: parsedSeries })
  const markdown = renderGenerated('script', scriptValue, {}), parsed = parseScript(markdown)
  assert.equal(parsed.scenes.length, 2)
  const input = { series: parsedSeries, scenes: parsed.scenes.map(scene => ({ number: scene.number,
    first_line: parsed.lines.indexOf(scene.lines[0]) + 1, last_line: parsed.lines.indexOf(scene.lines.at(-1)) + 1 })) }
  const shot = { size: '近景', camera: '固定', duration: 4, roles: ['林'], video: '林看向门口。', keyframe: 'An adult man in a room.' }
  const storyboard = { scenes: { scene_1: { first_shot: shot, cuts: [] }, scene_2: { first_shot: shot, cuts: [] } } }
  assert.deepEqual(generationSchema('storyboard', input).required, ['scenes'])
  assert.throws(() => validateGenerated('storyboard', { scenes: { scene_1: storyboard.scenes.scene_1 } }, input), /scenes.scene_2/)
  validateGenerated('storyboard', storyboard, input)
  assert.throws(() => validateGenerated('storyboard', storyboard, { ...input, duration_range: { min: 20, max: 30 } }), /镜头总时长 8 秒/)
  const marked = insertStoryboard(markdown, renderGenerated('storyboard', storyboard, input))
  assert.equal(validateScript(parsedSeries, parseScript(marked), { storyboard: true }).shots[1].lines[0].text, '音效：门铃响。')
})
test('project routes write Markdown, expose two episode denominator and reject unauthenticated writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'drama-routes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const skills = createSkillsStore()
    await skills.seed('drama', new URL('drama/', template).pathname)
    await skills.seed('director-cad24a59', new URL('director-cad24a59/', template).pathname)
    const directors = createDirectorStore()
    const store = createProjectStore({ newId: () => '1234abcd', directorExists: name => directors.has(name),
      complete: async () => seriesResult })
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
    const scriptValue = { scenes: [
      { number: 1, name: '房间', roles: ['林'], lines: [{ kind: 'action', speaker: '', tone: '', text: '林拿起信。' }] },
      { number: 2, name: '房间', roles: ['林'], lines: [{ kind: 'action', speaker: '', tone: '', text: '林打开信。' }] },
    ] }
    const script = renderGenerated('script', scriptValue, {})
    const shot = { size: '近景', camera: '固定', duration: 30, roles: ['林'], video: '林看信。', keyframe: 'A man holding a letter.' }
    const storyboard = { scenes: { scene_1: { first_shot: shot, cuts: [] }, scene_2: { first_shot: shot, cuts: [] } } }
    const prompts = []; let mode = 'script'
    const store = createProjectStore({ newId: () => '1234abcd', complete: async prompt => {
      const input = JSON.parse(prompt.user); prompts.push(input)
      if (mode === 'script') return input.correction ? scriptValue : { scenes: [{ ...scriptValue.scenes[0], name: '房间窗边' }, scriptValue.scenes[1]] }
      if (mode === 'fail') return { scenes: [{ ...scriptValue.scenes[0], name: '不存在' }, scriptValue.scenes[1]] }
      if (mode === 'single') { assert.equal(input.target_shot.id, 'S02'); assert.match(input.numbered_lines, /^2\./); assert.doesNotMatch(input.numbered_lines, /拿起/); return { shot: input.correction ? { ...shot, video: '林把信折好。' } : { ...shot, roles: ['不存在'] } } }
      assert.deepEqual(input.scenes.map(scene => scene.first_line), [1, 2])
      return input.correction ? storyboard : { scenes: { scene_1: storyboard.scenes.scene_1 } }
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
    assert.match(prompts.at(-1).correction.error, /scenes.scene_2/)
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
