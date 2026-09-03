import test from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { projectCreate } from '../../src/application/project-service.js'
import { episodeCreate, episodeUpdate } from '../../src/application/episode-service.js'
import { createProductionService } from '../../src/application/production-service.js'

async function fixture(t, targetDurationSec = 20) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-v2-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const project = await projectCreate({ workspace }, { title: '动态长视频项目' })
  const body = {
    projectId: project.project.id,
    episodeId: 'episode-01',
    title: '第一集',
    sourceText: '角色在雨夜重逢，完成选择并走向新的生活。',
    targetDurationSec,
    castPrompt: '同一位成年角色，黑色短发和蓝色外套',
    stylePrompt: '写实电影光线，竖屏构图',
  }
  return { workspace, projectId: project.project.id, body }
}

async function eventually(check, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (!['running', 'queued'].includes(result.state.status)) return result
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('production did not settle')
}

test('defaults new episodes to ten seconds and enforces the lower bound', async t => {
  const { workspace, body } = await fixture(t)
  delete body.targetDurationSec
  const created = await episodeCreate({ workspace }, body)
  assert.equal(created.episode.targetDurationSec, 10)
  assert.equal(created.plan.chapters.length, 1)
  await assert.rejects(
    episodeUpdate({ workspace }, { projectId: body.projectId, episodeId: body.episodeId, updates: { targetDurationSec: 9 } }),
    /targetDurationSec 超出范围/,
  )
})

test('creates dynamic chapters with one start frame and five continuation frames', async t => {
  const { workspace, body } = await fixture(t, 41)
  const created = await episodeCreate({ workspace }, body)
  assert.equal(created.plan.chapters.length, 3)
  assert.equal(created.tasks.filter(task => task.type === 'start_frame').length, 3)
  assert.equal(created.tasks.filter(task => task.type === 'keyframe').length, 15)
  assert.equal(created.tasks.filter(task => task.type === 'chapter').length, 3)
  for (const chapter of created.plan.chapters) {
    assert.equal(chapter.anchors.length, 6)
    assert.equal(chapter.anchors[0].role, 'start')
    assert.deepEqual(chapter.anchors.slice(1).map(anchor => anchor.role), Array(5).fill('continuation'))
  }
})

test('rejects conflicting aspect-ratio text instead of silently stretching the video', async t => {
  const { workspace, body } = await fixture(t)
  await assert.rejects(
    episodeCreate({ workspace }, { ...body, aspectRatio: '9:16', stylePrompt: '写实电影感，16:9 横屏' }),
    /画幅与已选 9:16 冲突/,
  )
})

test('rejects plans that do not contain exactly six anchors per chapter', async t => {
  const { workspace, body } = await fixture(t)
  const created = await episodeCreate({ workspace }, body)
  await assert.rejects(
    episodeUpdate({ workspace }, {
      projectId: body.projectId,
      episodeId: body.episodeId,
      updates: { plan: { chapters: [{ ...created.plan.chapters[0], anchors: created.plan.chapters[0].anchors.slice(0, 5) }] } },
    }),
    /必须正好包含 6 个锚点/,
  )
})

test('rejects repeated full-story prompts before any image task is created', async t => {
  const { workspace, body } = await fixture(t)
  const repeated = {
    source: 'producer-agent',
    chapters: [{
      id: 'chapter-01', title: '重复章节',
      anchors: Array.from({ length: 6 }, (_, index) => ({
        id: `chapter-01-anchor-${String(index + 1).padStart(2, '0')}`,
        role: index === 0 ? 'start' : 'continuation',
        imagePrompt: '整篇故事原样重复，没有具体镜头变化。',
        motionPrompt: `动作 ${index + 1}`,
      })),
    }],
  }
  await assert.rejects(episodeCreate({ workspace }, { ...body, plan: repeated }), /存在完全重复的画面提示/)
})

test('rejects an incompatible image-edit contract before submitting paid work', async t => {
  const { workspace, projectId, body } = await fixture(t)
  await episodeCreate({ workspace }, body)
  let submissions = 0
  const comfy = {
    async inspect(template) {
      if (template === 'qwen-image-edit') return { ok: true, slots: { prompt: {}, image: {} } }
      if (template === 'wan22-remix-long') {
        return { ok: true, slots: Object.fromEntries([
          ...Array.from({ length: 6 }, (_, index) => [`image_${index + 1}`, {}]),
          ...Array.from({ length: 6 }, (_, index) => [`prompt_${index + 1}`, {}]),
        ]) }
      }
      return { ok: true, slots: { prompt: {} } }
    },
    async generate() { submissions += 1; return { ok: true, job_id: 'unexpected' } },
  }
  const production = createProductionService({}, { workspace }, comfy)
  t.after(() => production.dispose())

  await assert.rejects(
    production.start({ projectId, episodeId: body.episodeId, confirmAuthorizedContent: true }),
    /缺少输入槽：character_image/,
  )
  assert.equal(submissions, 0)
})

test('runs start frame, five edited keyframes, six-anchor video and final review', async t => {
  const { workspace, projectId, body } = await fixture(t)
  const image = path.join(workspace, 'remote.png')
  const video = path.join(workspace, 'remote.mp4')
  await Promise.all([writeFile(image, 'image'), writeFile(video, 'video')])
  const ffmpeg = path.join(workspace, 'fake-ffmpeg.sh')
  const ffprobe = path.join(workspace, 'fake-ffprobe.sh')
  await writeFile(ffmpeg, '#!/bin/sh\nfor last do :; done\nprintf video > "$last"\n')
  await writeFile(ffprobe, '#!/bin/sh\nprintf "21.5\\n"\n')
  await Promise.all([chmod(ffmpeg, 0o755), chmod(ffprobe, 0o755)])

  const submissions = []
  const jobs = new Map()
  const comfy = {
    async generate(args) {
      submissions.push(args)
      const id = `job-${submissions.length}`
      jobs.set(id, args.template === 'wan22-remix-long' ? { kind: 'video', path: video } : { kind: 'image', path: image })
      return { ok: true, job_id: id }
    },
    async job(args) {
      return { ok: true, status: 'success', outputs: [jobs.get(args.job_id)] }
    },
  }
  const config = { workspace, ffmpeg, ffprobe }
  await episodeCreate(config, body)
  const production = createProductionService({}, config, comfy)
  t.after(() => production.dispose())
  await assert.rejects(production.start({ projectId, episodeId: body.episodeId }), /必须确认/)
  await production.start({ projectId, episodeId: body.episodeId, confirmAuthorizedContent: true })
  const finished = await eventually(() => production.status({ projectId, episodeId: body.episodeId }))

  assert.equal(finished.state.status, 'awaiting_review')
  assert.equal(finished.tasks.filter(task => task.type === 'start_frame' && task.status === 'succeeded').length, 1)
  assert.equal(finished.tasks.filter(task => task.type === 'keyframe' && task.status === 'succeeded').length, 5)
  const chapterSubmission = submissions.find(args => args.template === 'wan22-remix-long')
  assert.ok(chapterSubmission)
  assert.equal(new Set(Array.from({ length: 6 }, (_, index) => chapterSubmission[`image_${index + 1}`])).size, 6)
  const editedFrames = submissions.filter(args => args.template === 'qwen-image-edit')
  assert.equal(editedFrames.length, 5)
  assert.equal(editedFrames.every(args => args.image && args.character_image), true)

  await production.approve({ projectId, episodeId: body.episodeId, reviewer: 'qa.user', confirmHumanReviewPassed: true })
  const approved = await production.status({ projectId, episodeId: body.episodeId })
  assert.equal(approved.state.status, 'approved')
  assert.equal(approved.state.approval.reviewer, 'qa.user')
  assert.equal((await readFile(path.join(workspace, 'projects', projectId, approved.state.final.path), 'utf8')), 'video')

  const renamed = await episodeUpdate(config, {
    projectId, episodeId: body.episodeId, updates: { title: '只修改标题' },
  })
  assert.equal(renamed.state.status, 'approved')
  const changed = await episodeUpdate(config, {
    projectId, episodeId: body.episodeId, updates: { sourceText: '角色改在清晨车站重逢。' },
  })
  assert.equal(changed.state.status, 'ready')
  assert.equal(changed.state.final, null)
  assert.equal(changed.tasks.find(task => task.id === 'asset:cast-main').status, 'succeeded')
  assert.equal(changed.tasks.filter(task => task.id !== 'asset:cast-main').every(task => task.status === 'pending'), true)
})

test('retry resumes an authorized production instead of leaving pending tasks stuck', async t => {
  const { workspace, projectId, body } = await fixture(t)
  const image = path.join(workspace, 'remote.png')
  const video = path.join(workspace, 'remote.mp4')
  await Promise.all([writeFile(image, 'image'), writeFile(video, 'video')])
  const ffmpeg = path.join(workspace, 'fake-ffmpeg.sh')
  const ffprobe = path.join(workspace, 'fake-ffprobe.sh')
  await writeFile(ffmpeg, '#!/bin/sh\nfor last do :; done\nprintf video > "$last"\n')
  await writeFile(ffprobe, '#!/bin/sh\nprintf "21.5\\n"\n')
  await Promise.all([chmod(ffmpeg, 0o755), chmod(ffprobe, 0o755)])

  let failedEditAttempts = 0
  let sequence = 0
  const jobs = new Map()
  const comfy = {
    async generate(args) {
      if (args.template === 'qwen-image-edit' && failedEditAttempts < 2) {
        failedEditAttempts += 1
        return { ok: false, code: 'SLOT_UNKNOWN', message: 'Unknown slots: character_image' }
      }
      const id = `job-${++sequence}`
      jobs.set(id, args.template === 'wan22-remix-long' ? { kind: 'video', path: video } : { kind: 'image', path: image })
      return { ok: true, job_id: id }
    },
    async job(args) {
      return { ok: true, status: 'success', outputs: [jobs.get(args.job_id)] }
    },
  }
  const config = { workspace, ffmpeg, ffprobe }
  await episodeCreate(config, body)
  const production = createProductionService({}, config, comfy)
  t.after(() => production.dispose())

  await production.start({ projectId, episodeId: body.episodeId, confirmAuthorizedContent: true })
  const failed = await eventually(() => production.status({ projectId, episodeId: body.episodeId }))
  assert.equal(failed.state.status, 'needs_attention')

  const retried = await production.retry({ projectId, episodeId: body.episodeId, taskId: 'anchor:chapter-01-anchor-02' })
  assert.equal(retried.state.status, 'running')
  const finished = await eventually(() => production.status({ projectId, episodeId: body.episodeId }))
  assert.equal(finished.state.status, 'awaiting_review')
  assert.equal(finished.tasks.every(task => task.status === 'succeeded'), true)
})
