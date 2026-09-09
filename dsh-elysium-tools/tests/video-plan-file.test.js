import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { resolveVideoPlan } from '../src/workflows/video-plan-file.js'
import { validateVideoPlan } from '../src/workflows/video-plan.js'
import { withConfig } from '../src/config.js'

test('HTTP plan preserves prompts and references without fetching or copying media', async () => {
  const requests = []
  const plan = { duration: 20, shots: [1, 2].map(i => ({ id: `s${i}`, duration: 10, mode: 'reference',
    image_path: '/view?filename=reference.png&type=output', seed: i, prompt: `镜头${i}完整对白` })) }
  let body = plan
  const server = createServer((req, res) => { requests.push(req.url); res.end(JSON.stringify(body)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const result = await resolveVideoPlan({ plan_path: base + '/plan.json' })
    await withConfig({ MINIMAX_H3_COMFYUI_URL: base, MINIMAX_H3_COMFYUI_PUBLIC_URL: base }, () => validateVideoPlan(result))
    assert.deepEqual(result.shots.map(s => s.prompt), plan.shots.map(s => s.prompt))
    assert.equal(result.shots[0].image_path, base + plan.shots[0].image_path)
    assert.deepEqual(requests, ['/plan.json'])
    for (const invalid of [[], { plan_path: base + '/nested.json' }]) {
      body = invalid
      await assert.rejects(resolveVideoPlan({ plan_path: base + '/plan.json' }), { code: 'MODEL_INPUT_INVALID' })
    }
    await assert.rejects(resolveVideoPlan({ plan_path: base + '/plan.json', duration: 1 }), { code: 'MODEL_INPUT_INVALID' })
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('local and SSH plans are rejected before any file access', async () => {
  for (const plan_path of ['/tmp/plan.json', 'relative.json', 'file:///tmp/plan.json', 'ssh://host/root/plan.json', 'https://user:password@host/plan.json']) {
    await assert.rejects(resolveVideoPlan({ plan_path }), { code: 'MODEL_INPUT_INVALID' })
  }
})
