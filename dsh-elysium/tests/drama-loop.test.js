// 职责：验证 Markdown 保存、分镜覆盖、台词单源编译和新状态结构。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createSkillsStore } from '../src/database/managers/skills.js'
import { createDirectorStore } from '../src/database/managers/directors.js'
import { createFlowSkillStore } from '../src/database/managers/flow.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { insertStoryboard, parseProject, parseScript, parseSeries, stripVideoDialogue } from '../src/server/projects/documents.js'
import { compileShot, shotRoles } from '../src/server/projects/compile.js'

const skills = new URL('../../harness/.dsh/storages/elysium/pools/skills/', import.meta.url)
const overview = `一句话故事：一封信改变两个人\n## 世界观\n雨夜城市\n## 角色\n### 林晚（主角）\n简介：插画师\n定妆：adult woman, full body\n音色：清亮\n## 场景\n### 咖啡馆\n街角咖啡馆\n## 分集\n### 第 1 集 · 来信\n梗概：收到信\n钩子：来人\n### 第 2 集 · 真相\n梗概：查明真相\n钩子：和解\n`
const script = `## 场 1｜咖啡馆｜林晚\n动作：林晚拆开信。\n林晚（低声）：你来了。\n`

test('project frontmatter accepts quoted model values without keeping quote marks', () => {
  assert.deepEqual(parseProject('---\ntitle: "雨夜重逢"\ndirector: director-cad24a59\ngenre: "甜宠"\n---\n\n旧友重逢\n'),
    { title: '雨夜重逢', director: 'director-cad24a59', genre: '甜宠', synopsis: '旧友重逢' })
})

test('script lines stay unchanged when storyboard inserts markers and dialogue compiles from current lines', () => {
  const marked = insertStoryboard(script, `### 从第 1 行｜特写｜固定｜5 秒\n视频：林晚拆信，2 秒处开口。\n首帧：A woman reads a letter.`)
  const parsed = parseScript(marked)
  assert.deepEqual(parsed.lines.map(item => item.text), parseScript(script).lines.map(item => item.text))
  assert.equal(parsed.shots[0].lines.length, 2)
  const series = { characters: [{ name: '林晚', appearance: 'adult woman, full body', voice: '清亮' }], scenes: [{ name: '咖啡馆', description: '街角咖啡馆' }] }
  const anchors = { 林晚: { source_job_id: 'a'.repeat(32) } }
  assert.match(compileShot(series, parsed.shots[0], anchors).prompt, /林晚（低声；清亮）：你来了。/)
  const edited = parseScript(marked.replace('你来了。', '我来了。'))
  assert.match(compileShot(series, edited.shots[0], anchors).prompt, /我来了。/)
  assert.doesNotMatch(compileShot(series, edited.shots[0], anchors).prompt, /你来了。/)
})

test('storyboard video strips quoted dialogue before storage', () => {
  assert.equal(stripVideoDialogue('【1–4 秒】苏晴（轻笑）：你来了；【4–5 秒】她转身。'), '【1–4 秒】苏晴开口；【4–5 秒】她转身。')
})

test('deleted shot boundary leaves its lines unshot without changing following shots', () => {
  const original = '## 场 1｜咖啡馆｜林晚\n### [S01] 近景｜固定｜5 秒\n视频：动作\n首帧：still\n动作：开门。\n### [S02] 特写｜固定｜5 秒\n视频：动作\n首帧：still\n动作：拆信。\n### [S03] 特写｜固定｜5 秒\n视频：动作\n首帧：still\n动作：抬头。\n'
  const deleted = original.replace(/### \[S02\][^\n]*\n视频：[^\n]*\n首帧：[^\n]*/, '<!-- 未入镜 -->')
  const parsed = parseScript(deleted)
  assert.equal(parsed.lines[1].shot_id, null)
  assert.equal(parsed.lines[2].shot_id, 'S03')
})

test('project stores only creative Markdown and system state, and saves leave state untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-drama-loop-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const skillStore = createSkillsStore()
      await skillStore.seed('drama', new URL('drama/', skills).pathname)
      await skillStore.seed('director-cad24a59', new URL('director-cad24a59/', skills).pathname)
      const directors = createDirectorStore()
      const store = createProjectStore({ directorExists: name => directors.has(name), newId: () => '1234abcd' })
      const project = await store.change('create', { title: '雨夜来信', director: 'director-cad24a59', genre: '情感', synopsis: '旧信重现' })
      const stateFile = join(root, 'projects', project.id, 'state.json')
      const before = await readFile(stateFile, 'utf8')
      await store.planning.save({ id: project.id, step: 'series', markdown: overview })
      await store.planning.save({ id: project.id, step: 'script', episode: 1, markdown: script })
      assert.equal(await readFile(stateFile, 'utf8'), before)
      assert.equal((await store.list())[0].episode_count, 2)
      assert.equal((await store.readEpisode(project.id, 1)).script, script)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('shot lead follows the on-screen subject, not names mentioned in dialogue or overview order', () => {
  const characters = [{ name: '林远' }, { name: '苏晴' }, { name: '王总' }]
  const lines = texts => texts.map(text => ({ text }))
  assert.deepEqual(shotRoles(characters, lines(['王总（冷笑）：你那个前男友林远，听说回来了？'])), ['王总'])
  assert.deepEqual(shotRoles(characters, lines(['动作：苏晴撑着伞走过，看到林远。'])), ['苏晴', '林远'])
  const marked = insertStoryboard('## 场 1｜咖啡馆｜苏晴、林远\n动作：苏晴走过，看到林远。\n', '### 从第 1 行｜中景｜跟拍｜4 秒｜人物：林远、苏晴\n视频：走过。\n首帧：still')
  const shot = parseScript(marked).shots[0]
  assert.deepEqual(shot.roles, ['林远', '苏晴'])
  const series = { characters: characters.map(item => ({ ...item, appearance: item.name, voice: '' })), scenes: [{ name: '咖啡馆', description: '' }] }
  const anchors = { 林远: { source_job_id: 'b'.repeat(32) }, 苏晴: { source_job_id: 'c'.repeat(32) } }
  assert.equal(compileShot(series, shot, anchors).reference_job_id, 'b'.repeat(32))
  assert.equal(compileShot(series, { ...shot, roles: null }, anchors).reference_job_id, 'c'.repeat(32))
})

test('flow skill exposes only its overview and step files for full-text editing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-flow-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      await createSkillsStore().seed('drama', new URL('drama/', skills).pathname)
      const flow = createFlowSkillStore()
      assert.deepEqual(Object.keys((await flow.get()).files), ['SKILL.md', 'steps/project.md', 'steps/series.md', 'steps/script.md', 'steps/storyboard.md'])
      assert.equal((await flow.save({ file: 'steps/script.md', content: '# 剧本\n新规则\n' })).files['steps/script.md'], '# 剧本\n新规则\n')
      await assert.rejects(flow.save({ file: '../secret.md', content: 'x' }), /流程 Skill 文件无效/)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('flow skill examples always pass the document parsers', async () => {
  const step = async file => (await readFile(new URL(`drama/steps/${file}`, skills), 'utf8')).split(/^## 示例.*$/m)[1].trim() + '\n'
  assert.ok(parseProject(await step('project.md')).title)
  const series = parseSeries(await step('series.md'))
  assert.ok(series.characters.some(item => item.lead))
  const script = await step('script.md')
  const shots = parseScript(insertStoryboard(script, await step('storyboard.md'))).shots
  assert.ok(shots.length > 1)
  assert.equal(shots.flatMap(shot => shot.lines).length, parseScript(script).lines.length)
  for (const shot of shots) assert.ok(shot.roles?.every(name => series.characters.some(item => item.name === name)))
})

test('generated Markdown wrapped in a code fence is saved without the fence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-fence-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const skillStore = createSkillsStore()
      await skillStore.seed('drama', new URL('drama/', skills).pathname)
      await skillStore.seed('director-cad24a59', new URL('director-cad24a59/', skills).pathname)
      const directors = createDirectorStore()
      const store = createProjectStore({ directorExists: name => directors.has(name), newId: () => '1234abce', complete: async () => ({ markdown: '```markdown\n' + overview + '```' }) })
      const project = await store.change('create', { title: '雨夜来信', director: 'director-cad24a59', genre: '情感', synopsis: '旧信重现' })
      const saved = await store.planning.generate({ id: project.id, step: 'series' })
      assert.doesNotMatch(saved.series_text, /```/)
      assert.equal(saved.series.episodes.length, 2)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
