// 职责：验证 Markdown 保存、分镜覆盖、台词单源编译和新状态结构。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createSkillsStore } from '../src/database/managers/skills.js'
import { createDirectorStore } from '../src/database/managers/directors.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { insertStoryboard, parseScript } from '../src/server/projects/documents.js'
import { compileShot } from '../src/server/projects/compile.js'

const skills = new URL('../../harness/.dsh/storages/elysium/pools/skills/', import.meta.url)
const overview = `一句话故事：一封信改变两个人\n## 世界观\n雨夜城市\n## 角色\n### 林晚（主角）\n简介：插画师\n定妆：adult woman, full body\n音色：清亮\n## 场景\n### 咖啡馆\n街角咖啡馆\n## 分集\n### 第 1 集 · 来信\n梗概：收到信\n钩子：来人\n### 第 2 集 · 真相\n梗概：查明真相\n钩子：和解\n`
const script = `## 场 1｜咖啡馆｜林晚\n动作：林晚拆开信。\n林晚（低声）：你来了。\n`

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
