import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFactoryService, validateEpisodeSpec } from '../src/elysium/server/lib/factory.js'

function episode(id = 'factory-test') {
  return {
    schema_version: 'vmp-1',
    episode_id: id,
    title: 'Factory test',
    source_text: 'A fictional adult story.',
    profile: 'preview',
    seed: 42,
    cast_prompt: 'One consistent fictional adult cast.',
    negative_prompt: 'minor, non-consensual, watermark',
    compliance: {
      fictional_adults_only: true,
      all_participants_18_or_older: true,
      consensual_content: true,
      rights_confirmed: true,
    },
    shots: Array.from({ length: 2 }, (_, index) => ({
      id: `shot-${String(index + 1).padStart(2, '0')}`,
      image_prompt: `image ${index + 1}`,
      video_prompt: `motion ${index + 1}`,
    })),
  }
}

async function eventually(fn) {
  for (let index = 0; index < 100; index += 1) {
    const value = await fn()
    if (value.state.status !== 'running') return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('factory did not settle')
}

test('VMP contract rejects anything other than two ordered shots and explicit compliance', () => {
  const valid = episode()
  assert.equal(validateEpisodeSpec(valid).blocks, 2)
  assert.equal(validateEpisodeSpec(episode('beach-story')).episode_id, 'beach-story')
  assert.throws(() => validateEpisodeSpec(episode('Bad/Story')), /episode_id/)
  assert.throws(() => validateEpisodeSpec({ ...valid, shots: valid.shots.slice(0, 1) }), /2 镜/)
  assert.throws(() => validateEpisodeSpec({ ...valid, compliance: { ...valid.compliance, rights_confirmed: false } }), /rights_confirmed/)
})

test('factory persists two images, two videos, QC and human approval', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'elysium-factory-'))
  const sourceDir = path.join(root, 'mock-output')
  await import('node:fs/promises').then(fs => fs.mkdir(sourceDir, { recursive: true }))
  const image = path.join(sourceDir, 'image.png')
  const video = path.join(sourceDir, 'video.mp4')
  await writeFile(image, 'fake image')
  await writeFile(video, 'fake video')
  const ffmpeg = path.join(root, 'fake-ffmpeg.sh')
  const ffprobe = path.join(root, 'fake-ffprobe.sh')
  await writeFile(ffmpeg, '#!/bin/sh\nfor last do :; done\nprintf video > "$last"\n')
  await writeFile(ffprobe, '#!/bin/sh\nprintf "41.25\\n"\n')
  await Promise.all([chmod(ffmpeg, 0o755), chmod(ffprobe, 0o755)])

  let sequence = 0
  const jobs = new Map()
  const comfy = {
    async generate(args) {
      const id = `job-${++sequence}`
      jobs.set(id, args.template === 'qwen-image-t2i'
        ? { kind: 'image', path: image, args }
        : { kind: 'video', path: video, args })
      return { ok: true, job_id: id, status: 'running' }
    },
    async job(args) {
      return { ok: true, status: 'success', outputs: [jobs.get(args.job_id)] }
    },
  }
  const factory = createFactoryService({}, { workspace: root, ffmpeg, ffprobe }, comfy)
  const spec = episode()
  await factory.execute({ action: 'create', episode: spec })
  await assert.rejects(factory.execute({ action: 'run', spec: `${spec.episode_id}.json` }), /付费生成前/)
  await factory.execute({ action: 'run', spec: `${spec.episode_id}.json`, stage: 'all', confirm_authorized_adults: true })
  const done = await eventually(() => factory.execute({ action: 'status', spec: `${spec.episode_id}.json` }))
  assert.equal(done.state.status, 'qc_passed')
  assert.equal(done.state.progress.images_ready, 2)
  assert.equal(done.state.progress.blocks_ready, 2)
  assert.equal(done.state.final.duration_seconds, 41.25)
  const videoJobs = [...jobs.values()].filter(job => job.kind === 'video')
  assert.equal(videoJobs.length, 2)
  assert.deepEqual(Object.keys(videoJobs[0].args).filter(key => /^image_\d$/.test(key)), ['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6'])
  assert.deepEqual(new Set(Array.from({ length: 6 }, (_, index) => videoJobs[0].args[`image_${index + 1}`])).size, 1)

  await factory.execute({
    action: 'approve',
    spec: `${spec.episode_id}.json`,
    reviewer: 'qa.user',
    confirm_human_review_passed: true,
  })
  const approved = await factory.execute({ action: 'status', spec: `${spec.episode_id}.json` })
  assert.equal(approved.state.status, 'approved')
  assert.equal(JSON.parse(await readFile(approved.state.review.path, 'utf8')).passed, true)
})
