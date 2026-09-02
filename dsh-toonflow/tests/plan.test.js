import assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { projectCreate } from '../lib/lib/project.js'
import { planGet, planUpdateShot } from '../lib/lib/plan.js'
import { projectDir, writeJsonAtomic } from '../lib/lib/store.js'

test('updates a shot atomically and refreshes the project summary', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-toonflow-plan-test-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const config = { workspace }
  const created = await projectCreate(config, { title: '镜头测试' })
  const id = created.project.id
  const dir = projectDir(config, id)
  await writeJsonAtomic(path.join(dir, 'shots.json'), [{
    id: 'shot-001',
    order: 1,
    durationSec: 5,
    characterIds: [],
    sceneId: null,
    description: '旧描述',
    camera: '',
    imagePrompt: '',
    videoPrompt: '',
    status: 'draft',
    retryCount: 0,
    lastError: null,
  }])

  const updated = await planUpdateShot(config, {
    projectId: id,
    shotId: 'shot-001',
    updates: { description: '新描述', imagePrompt: 'cinematic scene' },
  })
  assert.equal(updated.shot.description, '新描述')
  assert.equal(updated.shot.imagePrompt, 'cinematic scene')
  assert.ok(updated.shot.updatedAt)

  const persisted = await planGet(config, { projectId: id })
  assert.equal(persisted.shots[0].description, '新描述')
  assert.equal(persisted.project.updatedAt, updated.project.updatedAt)
})
