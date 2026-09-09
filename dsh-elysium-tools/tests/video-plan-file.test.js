import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm, copyFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveVideoPlan } from '../src/workflows/video-plan-file.js'
import { validateVideoPlan } from '../src/workflows/video-plan.js'
import { buildVideoGraph, loadVideoTemplates } from '../src/workflows/video-graph.js'

const root = await realpath(await mkdtemp(join(tmpdir(), 'director-plan-')))
process.env.ARTIFACTS_ROOT = root
after(() => rm(root, { recursive: true, force: true }))
const source = join(root, 'episode')
await mkdir(source)
await writeFile(join(source, 'reference.png'), 'reference bytes')
const plan = { duration: 20, shots: [1, 2].map(i => ({ id: `s${i}`, duration: 10,
  mode: 'reference', image_path: 'reference.png', seed: i, prompt: `镜头${i}完整对白、人物与动作。` })) }
await writeFile(join(source, 'plan.json'), JSON.stringify(plan))

test('file input preserves prompts and timing, snapshots references and selects director graph', async () => {
  const resolved = await resolveVideoPlan({ plan_path: join(source, 'plan.json') })
  await validateVideoPlan(resolved)
  assert.deepEqual(resolved.shots.map(s => s.prompt), plan.shots.map(s => s.prompt))
  assert.equal(resolved.shots[0].image_path, resolved.shots[1].image_path)
  assert.equal(await readFile(resolved.shots[0].image_path, 'utf8'), 'reference bytes')
  const graph = buildVideoGraph(resolved, { [resolved.shots[0].image_path]: { name: 'uploaded.png' } }, await loadVideoTemplates(), 'test')
  assert.equal(graph.workflowName, 'workflow_director_video')
  assert.equal(graph.graph.s1_director.inputs.prompt, plan.shots[1].prompt)
  assert.equal(graph.graph.s0_director.inputs.duration + graph.graph.s1_director.inputs.duration, 20)
})

test('SSH plan copies only referenced assets once and leaves the source unchanged', async () => {
  const calls = []
  const resolved = await resolveVideoPlan({ plan_path: 'ssh://veo-comfyui/root/productions/ep/plan.json' }, undefined,
    async (host, path, target) => {
      calls.push([host, path])
      await copyFile(join(source, path.endsWith('.json') ? 'plan.json' : 'reference.png'), target)
    })
  await validateVideoPlan(resolved)
  assert.deepEqual(calls, [['veo-comfyui', '/root/productions/ep/plan.json'], ['veo-comfyui', '/root/productions/ep/reference.png']])
  assert.deepEqual(JSON.parse(await readFile(join(source, 'plan.json'), 'utf8')), plan)
})

test('rejects field overrides, path traversal, source symlinks outside the episode and malformed plans', async () => {
  for (const path of ['ssh://-oProxyCommand=x/root/a.json', 'ssh://user:password@host/root/a.json', 'ssh://host/root/../a.json', 'relative.json']) {
    await assert.rejects(resolveVideoPlan({ plan_path: path }), { code: 'MODEL_INPUT_INVALID' })
  }
  await assert.rejects(resolveVideoPlan({ plan_path: join(source, 'plan.json'), duration: 1 }), { code: 'MODEL_INPUT_INVALID' })
  await writeFile(join(root, 'outside.png'), 'outside')
  await symlink(join(root, 'outside.png'), join(source, 'escape.png'))
  for (const value of [{ plan_path: 'nested.json' }, [], { ...plan, shots: [{ ...plan.shots[0], image_path: 'escape.png' }] }]) {
    await writeFile(join(source, 'invalid.json'), JSON.stringify(value))
    await assert.rejects(resolveVideoPlan({ plan_path: join(source, 'invalid.json') }), { code: 'MODEL_INPUT_INVALID' })
  }
})
