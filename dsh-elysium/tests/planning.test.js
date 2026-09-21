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
const series = { logline: '一封信改变两人的关系', genre: '悬疑', episode_count: 2, episode_seconds: 10, world: '雨夜旧城',
  characters: [{ id: 'lin', name: '林', appearance: '灰色外套', voice: '低沉沙哑', personality: '克制' }],
  scenes: [{ id: 'room', name: '公寓', description: '旧厨房，冷蓝窗光' }],
  episodes: [1, 2].map(number => ({ number, title: `第${number}集`, summary: '信的秘密', hook: '门外有人' })) }
const timeline = { beats: [{ start: 0, end: 10, scene_id: 'room', roles: ['lin'], plot: '林打开信', emotion: '疑惑',
  dialogue: [{ role: 'lin', text: '是谁寄来的？', tone: '低声' }] }] }

test('planning reads editable Skills, appends versions and marks downstream review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-planning-'))
  try {
    const source = new URL('../skills/drama-planning/', import.meta.url).pathname
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const skills = createSkillsStore()
      await skills.seed('drama-planning', source)
      await skills.seed('shot-planning', new URL('../skills/shot-planning/', import.meta.url).pathname)
      const directors = createDirectorStore(), director = await directors.create({ display_name: '测试导演' })
      const requests = [], outputs = [series, timeline, series]
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
      await store.planning.generate({ id: project.id, step: 'timeline', episode: 1 })
      await store.planning.finalize({ id: project.id, step: 'timeline', episode: 1, version: 1 })
      await skills.saveReference(director.name, 'script.md', '导演专属：先写人物关系')
      await store.planning.generate(input)
      assert.match(requests[2].system, /导演专属：先写人物关系/)
      assert.match(requests[2].system, /根据项目标题/)
      await store.planning.finalize({ ...input, version: 2 })
      const value = await store.planning.read({ id: project.id })
      assert.equal(value.series.versions.length, 2)
      assert.equal(value.series.finalized, 2)
      assert.equal(value.episodes[1].timeline.needs_review, true)
      await store.planning.edit({ id: project.id, step: 'timeline', episode: 1, value: timeline })
      assert.equal((await store.planning.read({ id: project.id })).episodes[1].timeline.versions.length, 2)
    })
    assert.throws(() => validatePlanningResult('series', { ...series, episode_count: 101 }), /剧情总览内容或数量无效/)
    assert.throws(() => validatePlanningResult('shot-prompt', { prompt: '字'.repeat(20001) }), /超过 20000/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('finalized episode storyboard and prompt reach the production task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-episode-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      await createSkillsStore().seed('drama-planning', new URL('../skills/drama-planning/', import.meta.url).pathname)
      await createSkillsStore().seed('shot-planning', new URL('../skills/shot-planning/', import.meta.url).pathname)
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
      await accept('timeline', timeline, 1)
      await accept('storyboard', { shots: [{ scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '林打开信', duration: 10,
        dialogue: [{ role: 'lin', text: '是谁寄来的？' }] }] }, 1)
      const episode = await store.readEpisode(project.id, 1), shot = episode.acts[0].shots[0]
      assert.match(shot.id, /^[a-f0-9]{8}$/)
      assert.equal((await store.read(project.id)).episodes[0].acts[0].shots[0].id, shot.id)
      assert.equal((await store.list())[0].shot_count, 1)
      await assert.rejects(store.produce({ project_id: project.id, episode: 1, shot_ids: [shot.id], submission_id: 'test-one' }), /提示词尚未定稿/)
      await accept('shot-prompt', { prompt: '雨夜公寓，林近景，0-10 秒缓推；林以低沉沙哑音色说：是谁寄来的？雨声，中文字幕。' }, 1, shot.id)
      const ready = await store.readEpisode(project.id, 1)
      assert.equal(ready.acts[0].shots[0].prompt_finalized, true)
      await store.produce({ project_id: project.id, episode: 1, shot_ids: [shot.id], submission_id: 'test-two' })
      assert.equal(submission.tasks[0].binding.episode, 1)
      assert.equal(submission.tasks[0].plan.duration_seconds, 10)
      assert.match(submission.tasks[0].plan.prompt, /旧厨房，冷蓝窗光/)
      assert.match(submission.tasks[0].plan.prompt, /是谁寄来的？/)
      assert.equal((await store.readEpisode(project.id, 1)).acts[0].shots[0].job_id, 'a'.repeat(32))
      assert.equal((await store.list())[0].status, 'active')
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('timeline, storyboard and prompt reject broken time or changed dialogue', () => {
  const checked = { series, timeline }
  assert.throws(() => validatePlanningResult('timeline', { beats: [{ ...timeline.beats[0], start: 1 }] }, checked), /时间线连续性/)
  assert.throws(() => validatePlanningResult('timeline', { beats: [{ ...timeline.beats[0], end: 4 }, { ...timeline.beats[0], start: 5, end: 10 }] }, checked), /时间线连续性/)
  assert.throws(() => validatePlanningResult('timeline', { beats: [{ ...timeline.beats[0], end: 8 }] }, checked), /时间线连续性/)
  assert.throws(() => validatePlanningResult('timeline', { beats: [{ ...timeline.beats[0], dialogue: [{ role: 'missing', text: '错', tone: '低声' }] }] }, checked), /时间线连续性/)
  const shot = { scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '林打开信', duration: 10,
    dialogue: [{ role: 'lin', text: '是谁寄来的？' }] }
  assert.throws(() => validatePlanningResult('storyboard', { shots: [{ ...shot, duration: 10.5 }] }, checked), /分镜数量/)
  assert.throws(() => validatePlanningResult('storyboard', { shots: [{ ...shot, duration: 8 }] }, checked), /分镜总时长/)
  assert.throws(() => validatePlanningResult('storyboard', { shots: [{ ...shot, dialogue: [{ role: 'lin', text: '改了台词' }] }] }, checked), /分镜对白/)
  assert.throws(() => validatePlanningResult('shot-prompt', { prompt: '雨夜公寓' }, { shot }), /缺少定稿对白/)
})

test('prompt assembly includes common step, director addition and selected example', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-skill-prompt-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const skills = createSkillsStore()
      await skills.seed('drama-planning', new URL('../skills/drama-planning/', import.meta.url).pathname)
      await skills.seed('shot-planning', new URL('../skills/shot-planning/', import.meta.url).pathname)
      const directors = createDirectorStore(), director = await directors.create({ display_name: '测试导演' })
      const ref = join(root, 'pools', 'skills', director.name, 'references')
      await skills.saveReference(director.name, 'script.md', '导演剧本：重逢前铺垫')
      await skills.saveReference(director.name, 'storyboard.md', '导演分镜：缓慢推近')
      await mkdir(join(ref, 'steps'), { recursive: true })
      await writeFile(join(ref, 'steps', 'storyboard.md'), '旧步骤不应读取')
      await writeFile(join(ref, 'shot-prompt-example.md'), '导演专属范例：雨夜重逢')
      const requests = []
      const store = createProjectStore({ readJob: async job_id => ({ job_id }), summarizeJob: async () => ({ has_image: true }),
        directorExists: name => directors.has(name), newId: () => '1234abcd', complete: async request => {
          requests.push(request)
          if (request.name === 'drama_series') return series
          if (request.name === 'drama_timeline') return timeline
          if (request.name === 'drama_storyboard') return { shots: [{ scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '林打开信', duration: 10, dialogue: [{ role: 'lin', text: '是谁寄来的？' }] }] }
          return { prompt: '雨夜公寓，林低声说：是谁寄来的？' }
        } })
      const project = await store.change('create', { title: '雨夜的信', director: director.name, cover_job_id: cover })
      const accept = async (step, value, episode, shot_id) => {
        await store.planning.edit({ id: project.id, step, episode, shot_id, value })
        await store.planning.finalize({ id: project.id, step, episode, shot_id, version: 1 })
      }
      await accept('series', series)
      await store.planning.generate({ id: project.id, step: 'series' })
      assert.match(requests[0].system, /导演剧本：重逢前铺垫/)
      assert.doesNotMatch(requests[0].system, /导演分镜：缓慢推近/)
      await accept('timeline', timeline, 1)
      await store.planning.generate({ id: project.id, step: 'timeline', episode: 1 })
      assert.match(requests[1].system, /导演剧本：重逢前铺垫/)
      assert.doesNotMatch(requests[1].system, /导演分镜：缓慢推近/)
      await store.planning.generate({ id: project.id, step: 'storyboard', episode: 1 })
      assert.match(requests[2].system, /将本集定稿时间线拆成/)
      assert.match(requests[2].system, /导演分镜：缓慢推近/)
      assert.doesNotMatch(requests[2].system, /导演剧本：重逢前铺垫|旧步骤不应读取/)
      assert.equal(requests[2].llm.max_tokens, 16384)
      assert.doesNotMatch(requests[2].system, /人物动机、冲突/)
      await store.planning.finalize({ id: project.id, step: 'storyboard', episode: 1, version: 1 })
      const shot = (await store.readEpisode(project.id, 1)).acts[0].shots[0]
      await store.planning.generate({ id: project.id, step: 'shot-prompt', episode: 1, shot_id: shot.id })
      assert.match(requests[3].system, /导演分镜：缓慢推近/)
      assert.doesNotMatch(requests[3].system, /导演剧本：重逢前铺垫|旧步骤不应读取/)
      assert.match(requests[3].system, /导演专属范例：雨夜重逢/)
      assert.doesNotMatch(requests[3].system, /雨夜的旧公寓厨房/)
      assert.equal(requests[3].llm.max_tokens, 16384)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('timeline versions track previous drafts, reject stale basis and retire removed anchors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-timeline-versions-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      await createSkillsStore().seed('drama-planning', new URL('../skills/drama-planning/', import.meta.url).pathname)
      const directors = createDirectorStore(), first = await directors.create({ display_name: '导演甲' }), second = await directors.create({ display_name: '导演乙' })
      let request
      const store = createProjectStore({ readJob: async job_id => ({ job_id }), summarizeJob: async () => ({ has_image: true }),
        directorExists: name => directors.has(name), newId: () => '1234abcd', complete: async value => { request = value; return timeline } })
      const project = await store.change('create', { title: '雨夜的信', director: first.name, cover_job_id: cover })
      const edit = (step, value, episode) => store.planning.edit({ id: project.id, step, episode, value })
      const finalize = (step, version, episode) => store.planning.finalize({ id: project.id, step, episode, version })
      await edit('series', series); await finalize('series', 1)
      await edit('timeline', timeline, 1); await finalize('timeline', 1, 1)
      await edit('timeline', timeline, 2)
      const changed = { beats: [{ ...timeline.beats[0], plot: '上一集草稿有新线索' }] }
      await edit('timeline', changed, 1)
      assert.equal((await store.planning.read({ id: project.id })).episodes[2].timeline.needs_review, true)
      await store.planning.generate({ id: project.id, step: 'timeline', episode: 2 })
      assert.match(JSON.parse(request.user).previous_timeline.beats[0].plot, /新线索/)
      assert.equal((await store.planning.read({ id: project.id })).episodes[2].timeline.versions[1].based_on.previous_timeline, 2)
      await assert.rejects(finalize('timeline', 1, 2), /规划依据已变化/)
      await finalize('timeline', 2, 1)
      await finalize('timeline', 2, 2)
      const revised = { ...series, episode_count: 1, episodes: [series.episodes[0]],
        characters: [{ ...series.characters[0], id: 'kai', name: '凯', appearance: '黑色外套' }],
        scenes: [{ ...series.scenes[0], description: '旧厨房，暖黄灯光' }] }
      await edit('series', revised); await finalize('series', 2)
      const planning = await store.planning.read({ id: project.id })
      assert.equal(planning.episodes[1].timeline.needs_review, true)
      assert.equal(planning.episodes[2].retired, true)
      const anchors = (await store.read(project.id)).anchors
      assert.equal(anchors.find(item => item.role === 'lin').retired, true)
      assert.equal(anchors.find(item => item.role === 'kai').retired, undefined)
      assert.equal(anchors.find(item => item.role === 'scene-room').image_needs_review, true)
      await store.change('update', { id: project.id, director: second.name })
      assert.equal((await store.planning.read({ id: project.id })).series.needs_review, true)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('storyboard keeps matching shots, blocks active replacements and requires adoption and review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-storyboard-review-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const directors = createDirectorStore(), director = await directors.create({ display_name: '测试导演' })
      const submissions = []
      let nextJob = 0
      const store = createProjectStore({ readJob: async job_id => ({ job_id }), summarizeJob: async () => ({ has_image: true }),
        directorExists: name => directors.has(name), newId: () => '1234abcd', submitTasks: async request => {
          submissions.push(request)
          return { tasks: request.tasks.map(() => ({ task_id: (++nextJob).toString(16).padStart(32, '0') })) }
        } })
      const project = await store.change('create', { title: '雨夜的信', director: director.name, cover_job_id: cover })
      const single = { ...series, episode_count: 1, episodes: [series.episodes[0]] }
      const shots = [
        { scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '林打开信', duration: 5, dialogue: [{ role: 'lin', text: '是谁寄来的？' }] },
        { scene_id: 'room', roles: ['lin'], shot_size: '中景', camera: '固定', action: '林看向门口', duration: 5, dialogue: [] },
      ]
      const edit = (step, value, shot_id) => store.planning.edit({ id: project.id, step, episode: step === 'series' ? undefined : 1, shot_id, value })
      const finalize = (step, version, shot_id) => store.planning.finalize({ id: project.id, step, episode: step === 'series' ? undefined : 1, shot_id, version })
      await edit('series', single); await finalize('series', 1)
      await edit('timeline', timeline); await finalize('timeline', 1)
      await edit('storyboard', { shots }); await finalize('storyboard', 1)
      let current = (await store.readEpisode(project.id, 1)).acts[0].shots
      for (const shot of current) {
        await edit('shot-prompt', { prompt: `场景公寓：${shot.action}。${shot.dialogue.map(line => line.text).join(' ')}` }, shot.id)
        await finalize('shot-prompt', 1, shot.id)
      }
      const image = await store.generateAnchorImage({ project_id: project.id, role: 'lin' })
      assert.equal(image.tasks.length, 1)
      assert.deepEqual(submissions[0].tasks[0].binding, { type: 'anchor', role: 'lin' })
      await store.produce({ project_id: project.id, episode: 1, shot_ids: current.map(shot => shot.id), submission_id: 'first' })
      assert.equal(submissions[1].tasks[0].plan.mode, 't2va')
      assert.match(submissions[1].tasks[0].plan.prompt, /旧厨房，冷蓝窗光/)
      current = (await store.readEpisode(project.id, 1)).acts[0].shots
      for (const shot of current) await store.changeShot(project.id, 'update', { episode: 1, id: shot.id, status: 'succeeded' })
      await assert.rejects(store.requestEpisodeFilm(project.id, 1), /采用/)
      for (const shot of current) await store.changeShot(project.id, 'accept', { episode: 1, id: shot.id, accepted: true })
      await store.requestEpisodeFilm(project.id, 1)
      await store.changeAnchor(project.id, 'update', { role: 'scene-room', retired: true })
      await assert.rejects(store.produce({ project_id: project.id, episode: 1, shot_ids: [current[0].id], submission_id: 'retired' }), /锚点 scene-room 已失效/)
      await store.changeAnchor(project.id, 'update', { role: 'scene-room', retired: false })
      await store.changeAnchor(project.id, 'update', { role: 'lin', source: { type: 'job', job_id: 'a'.repeat(32) } })
      await store.produce({ project_id: project.id, episode: 1, shot_ids: current.map(shot => shot.id), submission_id: 'second' })
      assert.equal(submissions[2].tasks[0].plan.mode, 'i2va')
      assert.equal(submissions[2].tasks[0].plan.first_frame, `job:${'a'.repeat(32)}`)
      current = (await store.readEpisode(project.id, 1)).acts[0].shots
      assert.equal(current[0].accepted, false)
      for (const shot of current) {
        await store.changeShot(project.id, 'update', { episode: 1, id: shot.id, status: 'succeeded' })
        await store.changeShot(project.id, 'accept', { episode: 1, id: shot.id, accepted: true })
      }
      await edit('timeline', timeline); await finalize('timeline', 2)
      await assert.rejects(store.produce({ project_id: project.id, episode: 1, shot_ids: [current[0].id], submission_id: 'third' }), /分镜需复核/)
      await assert.rejects(store.requestEpisodeFilm(project.id, 1), /分镜需复核/)
      await edit('storyboard', { shots: [shots[0], { ...shots[1], action: '林走出门' }] }); await finalize('storyboard', 2)
      const replaced = (await store.readEpisode(project.id, 1)).acts[0].shots
      assert.equal(replaced[0].id, current[0].id)
      assert.equal(replaced[0].job_id, current[0].job_id)
      assert.equal(replaced[0].prompt_finalized, true)
      assert.notEqual(replaced[1].id, current[1].id)
      assert.equal(replaced[1].job_id, null)
      assert.equal(replaced[1].prompt_finalized, false)
      await store.changeShot(project.id, 'update', { episode: 1, id: replaced[1].id, job_id: 'b'.repeat(32), status: 'queued' })
      await edit('storyboard', { shots })
      await assert.rejects(finalize('storyboard', 3), /正在生成的镜头/)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
