import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { resolveShotRequest, validateProductionManifest } from '../src/video-production/manifest.js'
import { runProduction } from '../src/video-production/runner.js'

const configured = callback => withConfig({ COMFYUI_URL: 'https://example.invalid', ELYSIUM_STATE_ROOT: '/unused' }, callback)

const manifest = () => validateProductionManifest({
  version: 1,
  project_id: 'abcd1234',
  profile: 'preview',
  shots: [
    { id: 'shot-001', request: { mode: 't2va', prompt: 'An empty cafe.' }, media: {}, produces_anchor: { id: 'scene', frame_index: 36 } },
    { id: 'shot-002', request: { mode: 'i2va', prompt: 'Continue the cafe.' }, media: { first_frame: { anchor: 'scene' } } },
  ],
})

async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'production-runner-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  return stateRoot
}

test('manifest rejects forward anchor references and unknown fields', () => {
  const value = { version: 1, project_id: 'bad', profile: 'preview', shots: [{ id: 'one', request: { mode: 'i2va', prompt: 'x' }, media: { first_frame: { anchor: 'later' } } }] }
  assert.throws(() => validateProductionManifest(value), /尚未产出的锚点/)
  assert.throws(() => validateProductionManifest({ ...value, extra: true }), /未知字段 extra/)
})

test('resolved request uses the root profile and server anchor URL', async () => {
  const value = manifest(), url = 'https://example.invalid/view?filename=scene.png&type=output'
  assert.deepEqual(await configured(() => resolveShotRequest(value, value.shots[1], { scene: { url } })), { profile: 'preview', mode: 'i2va', prompt: 'Continue the cafe.', first_frame: url })
})

test('runner persists receipts, anchors and progress and reuses completed shots', async t => {
  const stateRoot = await fixture(t), calls = [], references = [], historyReads = []
  const executeShot = async (_projectId, request) => {
    calls.push(request)
    const job_id = String(calls.length).padStart(32, '0')
    return { request, job_id, result: { status: 'succeeded', comfyui_prompt_id: job_id, comfyui_view_url: `https://example.invalid/view?filename=${job_id}.mp4&type=output` } }
  }
  const extractReference = async input => {
    references.push(input)
    return { url: 'https://example.invalid/view?filename=scene.png&type=output', source_job_id: input.source.job_id }
  }
  const client = { request: async path => { const id = path.split('/').at(-1);historyReads.push(id);return { [id]: { status: { completed: true } } } } }
  const value = manifest(), options = { stateRoot, executeShot, extractReference, client, log: () => {} }
  assert.equal((await configured(() => runProduction(value, options))).completed, 2)
  assert.equal(calls.length, 2);assert.equal(references.length, 1)
  assert.equal(historyReads.length, 2)
  assert.equal((await configured(() => runProduction(value, options))).completed, 2)
  assert.equal(calls.length, 2);assert.equal(references.length, 1)
  assert.equal(historyReads.length, 2)
  const root = join(stateRoot, 'projects', value.project_id, 'production')
  const progress = JSON.parse(await readFile(join(root, 'progress.json'), 'utf8'))
  assert.deepEqual({ completed: progress.completed, total: progress.total, checked_shot: progress.checked_shot }, { completed: 2, total: 2, checked_shot: 'shot-002' })
  const second = JSON.parse(await readFile(join(root, 'shots', 'shot-002.receipt.json'), 'utf8'))
  assert.equal(second.request.first_frame, 'https://example.invalid/view?filename=scene.png&type=output')
})

test('runner refuses changed manifests for an existing project state', async t => {
  const stateRoot = await fixture(t), value = validateProductionManifest({ version: 1, project_id: '1234abcd', profile: 'preview', shots: [{ id: 'one', request: { mode: 't2va', prompt: 'x' }, media: {} }] })
  const options = { stateRoot, executeShot: async (_projectId, request) => ({ request, job_id: 'a'.repeat(32), result: { status: 'succeeded' } }), log: () => {} }
  await configured(() => runProduction(value, options))
  await assert.rejects(configured(() => runProduction({ ...value, max_attempts: 4 }, options)), /禁止修改清单/)
})
