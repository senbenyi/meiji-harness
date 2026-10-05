import test from 'node:test'
import assert from 'node:assert/strict'
import { occupy, occupant } from '../server/flow/operations/operation-occupancy.js'
import { operations } from '../server/flow/operations/operation-registry.js'
import { conflicts } from '../shared/operation-conflicts.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { setupModel } from './fixtures/model.js'
import { recordStore } from '../server/data/task-store.js'

const cases = [
  { kind:'generate', lock:'episode', episodeId:'e1' },
  { kind:'generate', lock:'episode', episodeId:'e2' },
  { kind:'generate', lock:'project', episodeId:'e1' },
  { kind:'direct', lock:'episode', episodeId:'e1' },
  { kind:'direct', lock:'episode', episodeId:'e2' },
  { kind:'direct', lock:'project', episodeId:'e1' },
]
const expected = [[1,1,1,1,0,1],[1,1,1,0,1,1],[1,1,1,1,1,1],[1,0,1,1,0,1],[0,1,1,0,1,1],[1,1,1,1,1,1]]
test('single occupancy covers every generation/edit and scope combination', () => {
  for (const [i,a] of cases.entries()) for (const [j,b] of cases.entries()) {
    const first = { projectId:'project', ...a }, second = { projectId:'project', ...b }
    assert.equal(conflicts(first,second), Boolean(expected[i][j]), `${i}/${j}`)
    const release = occupy('/tmp/lock-table', first, {id:'first',label:'测试'})
    try { assert.equal(Boolean(occupant('/tmp/lock-table',second)), Boolean(expected[i][j])) }
    finally { release() }
    assert.equal(occupant('/tmp/lock-table',second), null)
  }
})
test('project writers explicitly declare their effective lock even with episode ID', () => {
  for (const key of ['summary','story','project-summary','episode-add','episode-edit','episode-delete','overview','source']) assert.equal(operations[key].lock,'project',key)
})
test('busy admission creates no records and cancellation releases the same occupancy', async t => {
  const e = await setupModel(t)
  const manager = createOperationManager({ home:e.home, execute:async (_op,deps) => new Promise((_,reject) => deps.signal.addEventListener('abort', () => reject(deps.signal.reason),{once:true})) })
  const first = manager.start(e.op('story'))
  await first.ready
  const before = await recordStore(e.home,e.id).list('operations')
  assert.throws(() => manager.start(e.op('scene-text',{episodeId:'other'})), error => error.code === 'OPERATION_BUSY' && error.busy.kind === 'generate' && error.busy.lock === 'project')
  assert.deepEqual(await recordStore(e.home,e.id).list('operations'),before)
  assert.equal(manager.list(e.id)[0].lock,'project')
  manager.cancel(first.id,e.id); await first.done
  assert.equal(occupant(e.home,e.op('story')),null)
})
