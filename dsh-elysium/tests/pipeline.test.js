// 职责：验证 fill 与 produce 的顺序和重复 tick 的幂等行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createPipelineDriver } from '../src/server/projects/pipeline.js'

const id = '1234abcd'
test('fill only completes blanks; produce submits each shot once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'drama-pipeline-'))
  try {
    await mkdir(join(root, 'projects', id), { recursive: true })
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const project = { id, series: null, episodes: [], anchors: { 林: { source_job_id: 'a'.repeat(32) } }, auto: { task: 'fill', paused: null, attempts: {} } }
      const calls = []
      const store = {
        read: async () => project,
        changeAuto: async (_, update) => { project.auto = update(project.auto); return project },
        planning: { generate: async ({ step, episode }) => { calls.push([step, episode]); if (step === 'series') project.series = { characters: [{ name: '林' }], episodes: [{ number: 1 }] }
          else if (step === 'script') project.episodes = [{ number: 1, script: '## 场 1｜房间｜林\n动作：林走进来。', shots: [] }]
          else { project.episodes[0].shots = [{ id: 'S01', status: 'pending', job_id: null, duration: 5 }]; project.episodes[0].storyboard_ready = true } } },
        validateProduction: async () => {},
        produceShot: async () => { calls.push(['submit']); project.episodes[0].shots[0] = { ...project.episodes[0].shots[0], job_id: 'b'.repeat(32), status: 'running' } },
        requestEpisodeFilm: async () => { calls.push(['film']) },
      }
      const drive = createPipelineDriver(store)
      for (let i = 0; i < 20 && project.auto.task; i++) { await drive(); await new Promise(resolve => setImmediate(resolve)) }
      assert.deepEqual(calls, [['series', undefined], ['script', 1], ['storyboard', 1]])
      project.auto.task = 'produce'
      await drive(); await drive()
      assert.equal(calls.filter(item => item[0] === 'submit').length, 1)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
