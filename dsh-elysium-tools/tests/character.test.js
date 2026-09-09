import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp, mkdir, realpath, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mockMedia } from './helpers/media-server.js'
import { withConfig, resolveConfig } from '../src/config.js'
import { characterView, characterSheet } from '../src/workflows/character.js'
import { getJob } from '../src/jobs/query.js'

const root = await realpath(await mkdtemp(join(tmpdir(), 'character-test-')))
const backend = await mockMedia(root)
const config = resolveConfig({ comfyUrl: backend.url, publicUrl: backend.url, artifactsRoot: join(root, 'artifacts'), stateRoot: join(root, 'state') })
await mkdir(config.ARTIFACTS_ROOT)
after(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
const run = fn => withConfig(config, fn)
const description = 'Adult woman, straight black hair, cream sweater, blue jeans, white shoes'
let front, side, back

test('character views bind the exact front image, reuse completed jobs and reject changed identity', async () => run(async () => {
  await assert.rejects(characterView({ view: 'side', description }))
  assert.equal(backend.prompts.length, 0)
  front = await characterView({ view: 'front', description })
  const frontGraph = backend.prompts.at(-1).prompt
  assert.equal(frontGraph['12'].inputs.control_net_name, 'xinsir-openpose-sdxl-1.0.safetensors')
  assert.deepEqual(frontGraph['5'].inputs.positive, ['13', 0])
  assert.match(frontGraph['11'].inputs.image, /^character-front-/)
  side = await characterView({ view: 'side', description, reference_job_id: front.job_id })
  const before = backend.prompts.length
  assert.equal((await characterView({ view: 'side', description, reference_job_id: front.job_id })).job_id, side.job_id)
  assert.equal(backend.prompts.length, before)
  await assert.rejects(characterView({ view: 'back', description: 'different clothes', reference_job_id: front.job_id }), /原始角色描述/)
  await assert.rejects(characterView({ view: 'back', description, reference_job_id: side.job_id }), /最初确认/)
  back = await characterView({ view: 'back', description, reference_job_id: front.job_id })
  for (const result of [side, back]) {
    assert.equal(result.character.reference_sha256, front.sha256)
    const request = JSON.parse(await readFile(join(root, 'state/jobs', result.job_id, 'input/request.json')))
    assert.equal(request.params.image_path, front.path)
    const graph = backend.prompts.find(p => p.client_id === result.job_id).prompt
    assert.equal(graph['8'].class_type, 'LoadImage')
    assert.equal(graph['10'].inputs.image[0], '8')
    assert.match(graph['11'].inputs.image, new RegExp(`^character-${result.character.view}-`))
    assert.deepEqual(graph['13'].inputs.image, ['11', 0])
    assert.deepEqual(result, JSON.parse(JSON.stringify(result)))
  }
}))

test('only three explicit attempts per view; failed tasks are not automatically resubmitted', async () => run(async () => {
  backend.controls.fail = true
  const before = backend.prompts.length
  const retry = () => characterView({ view: 'side', description, reference_job_id: front.job_id, retry: true })
  try {
    await assert.rejects(retry())
    const saved = JSON.parse(await readFile(join(root, 'state/characters', front.job_id, 'character.json')))
    const id = saved.views.side.at(-1)
    assert.equal((await getJob(id)).status, 'failed')
    await assert.rejects(characterView({ view: 'side', description, reference_job_id: front.job_id }), /原任务/)
    assert.equal(backend.prompts.length, before + 1)
    await assert.rejects(retry())
    assert.equal(backend.prompts.length, before + 2)
    await assert.rejects(retry(), /三次/)
    assert.equal(backend.prompts.length, before + 2)
  } finally { backend.controls.fail = false }
}))

test('composition enforces view identity, validates crops and has no inference nodes', async () => run(async () => {
  const args = { reference_job_id: front.job_id, side_job_id: side.job_id, back_job_id: back.job_id,
    crops: Array.from({ length: 3 }, () => ({ x: 116, y: 48, width: 600, height: 1120 })) }
  await assert.rejects(characterSheet({ ...args, side_job_id: back.job_id }), /视角不能互换/)
  const count = backend.prompts.length
  await assert.rejects(characterSheet({ ...args, crops: [{ x: 0, y: 0, width: 9999, height: 1216 }, ...args.crops.slice(1)] }))
  assert.equal(backend.prompts.length, count)
  const result = await characterSheet(args)
  assert.equal(result.media_kind, 'image')
  assert.equal(result.media_info.width, 2496)
  assert.equal(result.media_info.height, 1216)
  assert.equal(result.validation.human_review, 'not_run')
  assert.deepEqual(result.character.source_jobs, [front.job_id, side.job_id, back.job_id])
  const graph = backend.prompts.at(-1).prompt
  assert.ok(!Object.values(graph).some(n => /Sampler|LoaderSimple|IPAdapter/.test(n.class_type)))
  for (const [index, base] of [10, 20, 30].entries()) {
    assert.equal(graph[base + 3].inputs.x, index * 832 + 116)
    assert.equal(graph[base + 3].inputs.y, 48)
    assert.equal(graph[base + 2].inputs.height, 1120)
  }
}))
