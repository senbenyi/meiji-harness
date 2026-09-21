// 职责：验证不同分辨率本地镜头可重编码为含音轨的单集成片。
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { setTimeout as pause } from 'node:timers/promises'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { composeEpisodeFilm, createFilmDriver } from '../src/server/projects/film.js'
import { saveFilmJob, saveMedia, localMediaInput } from '../src/worker/index.js'
import { createDirectorStore } from '../src/database/managers/directors.js'

test('episode film reencodes mixed shot sizes and retains audio', { skip: ['ffmpeg', 'ffprobe'].some(name => spawnSync(name, ['-version']).status !== 0) }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-episode-film-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const directors = createDirectorStore(), director = await directors.create({ display_name: '导演' })
      const store = createProjectStore({ directorExists: name => directors.has(name), newId: () => '1234abcd',
        readJob: async job_id => ({ job_id }), summarizeJob: async () => ({ has_image: true }) })
      const project = await store.change('create', { title: '混合分辨率', director: director.name, cover_job_id: 'f'.repeat(32) })
      const ids = ['a'.repeat(32), 'b'.repeat(32)]
      for (const [index, size] of ['64x64', '96x64'].entries()) {
        const file = join(root, `shot-${index}.mp4`)
        execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${index ? 'blue' : 'red'}:s=${size}:r=24:d=0.5`,
          '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
        const media = await saveMedia(project.id, ids[index], Readable.toWeb(createReadStream(file)), { extension: '.mp4', kind: 'video' })
        await saveFilmJob(project.id, ids[index], media)
      }
      await store.saveEpisodeStoryboard(project.id, 1, [{ title: '第一集', shots: ids.map((job_id, index) => ({
        id: `shot-${index}`, role: '', action: '动作', subtitle: '', mode: 't2va', job_id, status: 'succeeded', notes: '' })) }])
      const queued = await store.requestEpisodeFilm(project.id, 1)
      assert.equal(queued.film_task.status, 'pending')
      await store.updateEpisodeFilmTask(project.id, 1, queued.film_task.task_id, { status: 'running' })
      const drive = createFilmDriver(store)
      assert.equal((await drive()).active, true)
      let film
      for (let attempt = 0; attempt < 100; attempt++) {
        film = await store.readEpisode(project.id, 1)
        if (film.film_task.status === 'succeeded') break
        await pause(50)
      }
      assert.equal(film.film_task.status, 'succeeded')
      assert.equal(film.deliverables.length, 1)
      const job = (await import('../src/worker/index.js')).getJob
      const path = await localMediaInput(await job(film.deliverables[0].job_id))
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]))
      const video = probe.streams.find(stream => stream.codec_type === 'video')
      assert.equal(video.width, 64); assert.equal(video.height, 64)
      assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'))
      assert.ok(Number(probe.format.duration) > 0.8)
      assert.equal((await composeEpisodeFilm(store, project.id, 1)).deliverables.length, 1)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
