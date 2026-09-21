// 职责：验证 Skill 驱动规划、版本定稿、下游复核和服务端输出边界。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createSkillsStore } from '../src/database/managers/skills.js'
import { createDirectorStore } from '../src/database/managers/directors.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { validatePlanningResult } from '../src/server/projects/planning-schema.js'

const cover = 'f'.repeat(32)
const series = { logline: '一封信改变两人的关系', genre: '悬疑', episode_count: 2, episode_seconds: 120, world: '雨夜旧城',
  characters: [{ id: 'lin', name: '林', appearance: '灰色外套', voice: '低沉沙哑', personality: '克制' }],
  scenes: [{ id: 'room', name: '公寓', description: '旧厨房，冷蓝窗光' }] }
const outline = { episodes: [1, 2].map(number => ({ number, title: `第${number}集`, conflict: '信的秘密', turn: '旧友出现', hook: '门外有人' })) }

test('planning reads editable Skills, appends versions and marks downstream review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-planning-'))
  try {
    const source = new URL('../skills/drama-planning/', import.meta.url).pathname
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const skills = createSkillsStore()
      await skills.seed('drama-planning', source)
      const directors = createDirectorStore(), director = await directors.create({ display_name: '测试导演' })
      const requests = [], outputs = [series, outline, series]
      const store = createProjectStore({ readJob: async job_id => ({ job_id }), summarizeJob: async () => ({ has_image: true }),
        directorExists: name => directors.has(name), newId: () => '1234abcd',
        complete: async request => { requests.push(request); return outputs.shift() } })
      const project = await store.change('create', { title: '雨夜的信', director: director.name, cover_job_id: cover })
      const input = { id: project.id, step: 'series' }
      await store.planning.generate(input)
      assert.match(requests[0].system, /人物短剧/)
      assert.match(requests[0].system, /根据项目标题/)
      await store.planning.finalize({ ...input, version: 1 })
      const anchors = (await store.read(project.id)).anchors
      assert.deepEqual(anchors.map(item => [item.role, item.kind]), [['lin', 'character'], ['scene-room', 'scene']])
      assert.match(anchors[0].description, /低沉沙哑/)
      await store.planning.generate({ id: project.id, step: 'outline' })
      await store.planning.finalize({ id: project.id, step: 'outline', version: 1 })
      const directorStep = join(root, 'pools', 'skills', director.name, 'references', 'steps')
      await mkdir(directorStep, { recursive: true })
      await writeFile(join(directorStep, 'series.md'), '导演专属：先写人物关系')
      await store.planning.generate(input)
      assert.match(requests[2].system, /导演专属：先写人物关系/)
      assert.doesNotMatch(requests[2].system, /根据项目标题/)
      await store.planning.finalize({ ...input, version: 2 })
      const value = await store.planning.read({ id: project.id })
      assert.equal(value.series.versions.length, 2)
      assert.equal(value.series.finalized, 2)
      assert.equal(value.outline.needs_review, true)
      await store.planning.edit({ id: project.id, step: 'outline', value: outline })
      assert.equal((await store.planning.read({ id: project.id })).outline.versions.length, 2)
    })
    assert.throws(() => validatePlanningResult('series', { ...series, episode_count: 101 }), /立项内容或数量无效/)
    assert.throws(() => validatePlanningResult('shot-prompt', { prompt: '字'.repeat(20001) }), /超过 20000/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('finalized episode storyboard and prompt reach the production task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-episode-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      await createSkillsStore().seed('drama-planning', new URL('../skills/drama-planning/', import.meta.url).pathname)
      const directors = createDirectorStore(), director = await directors.create({ display_name: '测试导演' })
      let submission
      const store = createProjectStore({ readJob: async job_id => ({ job_id }), summarizeJob: async () => ({ has_image: true }),
        directorExists: name => directors.has(name), newId: () => '1234abcd',
        submitTasks: async value => { submission = value; return { tasks: [{ task_id: 'a'.repeat(32) }] } } })
      const project = await store.change('create', { title: '雨夜的信', director: director.name, cover_job_id: cover })
      const accept = async (step, value, episode, shot_id) => {
        await store.planning.edit({ id: project.id, step, episode, shot_id, value })
        await store.planning.finalize({ id: project.id, step, episode, shot_id, version: 1 })
      }
      await accept('series', series)
      await accept('outline', outline)
      await accept('script', { scenes: [{ scene_id: 'room', roles: ['lin'], action: '林打开信', dialogue: [{ role: 'lin', text: '是谁寄来的？' }] }] }, 1)
      await accept('storyboard', { shots: [{ scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '林打开信', duration: 5,
        dialogue: [{ role: 'lin', text: '是谁寄来的？' }] }] }, 1)
      const episode = await store.readEpisode(project.id, 1), shot = episode.acts[0].shots[0]
      assert.match(shot.id, /^[a-f0-9]{8}$/)
      await assert.rejects(store.produce({ project_id: project.id, episode: 1, shot_ids: [shot.id], submission_id: 'test-one' }), /提示词尚未定稿/)
      await accept('shot-prompt', { prompt: '雨夜公寓，林近景，0-5 秒缓推；林以低沉沙哑音色说：是谁寄来的？雨声，中文字幕。' }, 1, shot.id)
      const ready = await store.readEpisode(project.id, 1)
      assert.equal(ready.acts[0].shots[0].prompt_finalized, true)
      await store.produce({ project_id: project.id, episode: 1, shot_ids: [shot.id], submission_id: 'test-two' })
      assert.equal(submission.tasks[0].binding.episode, 1)
      assert.equal(submission.tasks[0].plan.duration_seconds, 5)
      assert.equal(submission.tasks[0].plan.prompt, ready.acts[0].shots[0].prompt)
      assert.equal((await store.readEpisode(project.id, 1)).acts[0].shots[0].job_id, 'a'.repeat(32))
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
