import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectStore } from '../server/data/projects.js'
import { interruptRunning } from '../server/flow/interrupt.js'

test('a restart marks running films and activities as interrupted', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-interrupt-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      activity: 'films',
      episodes: [{
        id: 'e1',
        summary: '进城',
        films: {
          S01: { status: 'ready', url: '/films/S01' },
          S02: { status: 'running', promptId: 'job' },
        },
        activity: 'films',
        activityError: null,
      }],
    })
    await interruptRunning(projects)
    const saved = await projects.read(created.id)
    assert.equal(saved.activity, null)
    assert.equal(saved.activityError, '生成已中断，可以重新生成')
    const episode = saved.episodes[0]
    assert.equal(episode.activity, null)
    assert.equal(episode.films.S01.status, 'ready')
    assert.equal(episode.films.S02.status, 'interrupted')
    assert.equal(episode.films.S02.error, '生成已中断，可以重新生成')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
