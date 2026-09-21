// 职责：验证本地镜头重编码为含音轨、烧录字幕、响度统一的单集成片，并登记 SRT。
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { setTimeout as pause } from 'node:timers/promises'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { composeEpisodeFilm, createFilmDriver, subtitleText } from '../src/server/projects/film.js'
import { getJob, saveFilmJob, saveMedia, localMediaInput } from '../src/worker/index.js'
import { job, seedProject } from './fixtures/drama.mjs'

test('subtitles follow actual shot durations and split lines by character count', () => {
  const shots = [{ dialogue: [{ role: 'a', text: '一二' }, { role: 'b', text: '三四五六' }] }, { dialogue: [] }, { dialogue: [{ role: 'a', text: '七' }] }]
  assert.equal(subtitleText(shots, [3, 2, 1.5]),
    '1\n00:00:00,000 --> 00:00:01,000\n一二\n\n2\n00:00:01,000 --> 00:00:03,000\n三四五六\n\n3\n00:00:05,000 --> 00:00:06,500\n七\n')
})

test('episode film reencodes mixed shot sizes, burns subtitles and registers SRT', { skip: ['ffmpeg', 'ffprobe'].some(name => spawnSync(name, ['-version']).status !== 0) }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-episode-film-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const store = createProjectStore({ newId: () => '1234abcd' })
      const project = await store.change('create', { title: '混合分辨率', director: 'director-a', genre: '悬疑', synopsis: '信' })
      const ids = [job('a'), job('b')]
      await seedProject(root, project.id, { shotExtra: id => ({ job_id: ids[id === 's1' ? 0 : 1], status: 'succeeded', duration: 1 }) })
      for (const [index, size] of ['64x64', '96x64'].entries()) {
        const file = join(root, `shot-${index}.mp4`)
        execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${index ? 'blue' : 'red'}:s=${size}:r=24:d=0.5`,
          '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
        await saveFilmJob(project.id, ids[index], await saveMedia(project.id, ids[index], Readable.toWeb(createReadStream(file)), { extension: '.mp4', kind: 'video' }))
      }
      const queued = await store.requestEpisodeFilm(project.id, 1)
      assert.equal(queued.film_task.status, 'pending')
      const drive = createFilmDriver(store)
      assert.equal((await drive()).active, true)
      let film
      for (let attempt = 0; attempt < 200; attempt++) {
        film = await store.readEpisode(project.id, 1)
        if (['succeeded', 'failed'].includes(film.film_task.status)) break
        await pause(50)
      }
      assert.equal(film.film_task.status, 'succeeded', film.film_task.error)
      assert.deepEqual(film.deliverables.map(item => [item.type, item.label]), [['film', '第 1 集 · 第1集标题'], ['subtitle', '第 1 集 · 第1集标题']])
      const path = await localMediaInput(await getJob(film.deliverables[0].job_id))
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]))
      const video = probe.streams.find(stream => stream.codec_type === 'video')
      assert.equal(video.width, 64); assert.equal(video.height, 64)
      assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'))
      assert.ok(Number(probe.format.duration) > 0.8)
      const srt = await readFile(await localMediaInput(await getJob(film.deliverables[1].job_id)), 'utf8')
      assert.match(srt, /^1\n00:00:00,000 --> 00:00:00,5\d\d\n台词s1\n\n2\n00:00:00,5\d\d --> 00:00:01,0\d\d\n台词s2\n$/)
      assert.equal((await composeEpisodeFilm(store, project.id, 1)).deliverables.length, 2)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
