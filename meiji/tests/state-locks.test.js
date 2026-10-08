import test from 'node:test'
import assert from 'node:assert/strict'
import { occupy, occupant } from '../server/flow/operations/operation-occupancy.js'
import { operations } from '../server/flow/operations/operation-registry.js'
import { conflicts } from '../shared/operation-conflicts.js'
import { textTargets } from '../shared/run-templates.js'
import { createImmediateService } from '../server/flow/immediate-service.js'
import { setupModel } from './fixtures/model.js'
import { historyStore } from '../server/data/history-store.js'

// Run 步骤与即时保存共用一把占用：项目级写入与一切互斥，其余按集、按对象互斥。
const cases = [
  { lock: 'episode', episodeId: 'e1', target: 'shots' },
  { lock: 'episode', episodeId: 'e1', target: 'seconds:S01' },
  { lock: 'episode', episodeId: 'e1' },
  { lock: 'episode', episodeId: 'e2', target: 'shots' },
  { lock: 'project', episodeId: 'e1', target: 'summary' },
]
const expected = [[1,0,1,0,1],[0,1,1,0,1],[1,1,1,0,1],[0,0,0,1,1],[1,1,1,1,1]]
test('single occupancy covers every scope and target combination', () => {
  for (const [i, a] of cases.entries()) for (const [j, b] of cases.entries()) {
    const first = { projectId: 'project', ...a }, second = { projectId: 'project', ...b }
    assert.equal(conflicts(first, second), Boolean(expected[i][j]), `${i}/${j}`)
    const release = occupy('/tmp/lock-table', first, { id: 'first', label: '测试' })
    try { assert.equal(Boolean(occupant('/tmp/lock-table', second)), Boolean(expected[i][j])) }
    finally { release() }
    assert.equal(occupant('/tmp/lock-table', second), null)
  }
  assert.equal(conflicts({ projectId: 'a', lock: 'project' }, { projectId: 'b', lock: 'project' }), false)
})
test('project writers explicitly declare their effective lock even with episode ID', () => {
  for (const key of ['episode-add', 'episode-edit', 'episode-delete', 'overview', 'source']) assert.equal(operations[key].lock, 'project', key)
  for (const key of ['summary', 'project-summary', 'outline', 'characters', 'scenes', 'script']) assert.equal(textTargets[key].scope, key === 'summary' ? 'episode' : 'project', key)
})
test('busy admission records nothing and release frees the same occupancy', async t => {
  const e = await setupModel(t), edits = createImmediateService({ home: e.home })
  t.after(() => edits.dispose())
  const held = { projectId: e.id, episodeId: e.episodeId, target: 'summary', action: 'run-step', lock: 'project' }
  const release = occupy(e.home, held, { id: 'step', label: '摘要' })
  assert.throws(() => edits.start(e.op('scene-text', { episodeId: 'other', itemId: 'E01', fields: {} })), error => error.code === 'TARGET_BUSY' && error.busy.lock === 'project' && error.busy.label === '摘要')
  assert.deepEqual(edits.list(e.id), [])
  assert.deepEqual(await historyStore(e.home, e.id).list('events'), [])
  release()
  assert.equal(occupant(e.home, held), null)
})
