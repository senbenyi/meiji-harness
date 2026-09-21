import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withConfig } from '../src/config.js'
import { ComfyClient } from '../src/worker/models/protocols/comfyui/client.js'
import { collectVideoArtifacts } from '../src/worker/models/protocols/comfyui/artifacts.js'
import { buildVideoGraph, loadVideoTemplate } from '../src/worker/models/providers/runpod/workflows/minimax-h3/graph.js'
import { resolveServer, validateBackendPlan } from '../src/worker/models/index.js'
const validateVideoPlan = plan => validateBackendPlan(resolveServer(), plan)
import { VIDEO_MODES } from '../src/worker/models/contract.js'

const base = 'https://pod.test'
const view = name => `${base}/view?filename=${name}.png&subfolder=refs&type=output`
const plans = {
  t2va: { mode: 't2va', prompt: 'text scene' },
  i2va: { mode: 'i2va', prompt: 'image scene', first_frame: view('first') },
  fl2va: { mode: 'fl2va', prompt: 'transition', first_frame: view('first'), last_frame: view('last') },
  'fl2va-loop': { mode: 'fl2va-loop', prompt: 'loop', first_frame: view('first'), last_frame: view('last') },
  r2va: { mode: 'r2va', prompt: 'references', reference_image_1: view('one'), reference_image_2: view('two') },
}

const assertUiLinks = workflow => {
  for (const container of [workflow, ...workflow.definitions.subgraphs]) {
    const nodes = new Set(container.nodes.map(node => node.id))
    for (const link of container.links) {
      const [origin, target] = Array.isArray(link) ? [link[1], link[3]] : [link.origin_id, link.target_id]
      assert.ok(origin === -10 || nodes.has(origin), `missing UI link origin ${origin}`)
      assert.ok(target === -20 || nodes.has(target), `missing UI link target ${target}`)
    }
  }
}

test('five modes keep the H3 graph and patch only declared user bindings', async () => withConfig({ COMFYUI_URL: base }, async () => {
  assert.deepEqual(VIDEO_MODES, Object.keys(plans))
  for (const [mode, plan] of Object.entries(plans)) {
    await validateVideoPlan(plan)
    const bundle = await loadVideoTemplate(mode)
    const prepared = await buildVideoGraph(plan, 'job')
    assert.doesNotMatch(JSON.stringify(bundle), /Qwen3\.5|AILab_QwenVL/i, mode)
    assertUiLinks(bundle.workflow)
    const uiNodes = [...bundle.workflow.nodes, ...bundle.workflow.definitions.subgraphs.flatMap(subgraph => subgraph.nodes)]
    assert.equal(Object.values(bundle.graph).some(node => node.class_type?.startsWith('AILab_QwenVL')), false, mode)
    assert.equal(uiNodes.some(node => node.type?.startsWith('AILab_QwenVL')), false, mode)
    const changed = Object.keys(bundle.graph).filter(id => JSON.stringify(prepared.graph[id].inputs) !== JSON.stringify(bundle.graph[id].inputs))
    const bindings = [...bundle.bindings.prompt, ...Object.values(bundle.bindings.media), bundle.bindings.output]
    assert.deepEqual(new Set(changed), new Set(bindings.map(item => item.node)), mode)
    assert.equal(prepared.graph[prepared.previewNode].inputs.crf, 35)
    assert.deepEqual(prepared.graph.elysium_preview_resize.inputs.image, prepared.graph[prepared.outputNode].inputs.images)
    for (const binding of bundle.bindings.prompt) assert.equal(prepared.graph[binding.node].inputs[binding.input], plan.prompt)
    for (const [name, binding] of Object.entries(bundle.bindings.media)) assert.match(prepared.graph[binding.node].inputs[binding.input], new RegExp(`${new URL(plan[name]).searchParams.get('filename')} \\[output\\]$`))
    assert.equal(prepared.graph[bundle.bindings.output.node].inputs[bundle.bindings.output.input], `elysium/job/${mode}/final`)
    assert.deepEqual(prepared.source, bundle.source)
  }
}))

test('mode-specific inputs reject old and foreign contracts before submission', async () => withConfig({ COMFYUI_URL: base }, async () => {
  await assert.rejects(validateVideoPlan({ mode: 't2va', prompt: 'x', duration: 5 }), /未支持参数/)
  await assert.rejects(validateVideoPlan({ mode: 'i2va', prompt: 'x' }), /first_frame/)
  await assert.rejects(validateVideoPlan({ mode: 'fl2va', prompt: 'x', first_frame: view('first') }), /last_frame/)
  await assert.rejects(validateVideoPlan({ mode: 'r2va', prompt: 'x', reference_image_1: view('one'), reference_image_2: 'https://foreign.test/view?filename=x.png' }), /已配置的 ComfyUI/)
}))

test('dynamic H3 sockets, model choices and resolutions pass schema validation', async () => {
  const client = new ComfyClient('https://pod.test')
  client.request = async () => ({ Dynamic: { input: { required: { values: ['COMFY_AUTOGROW_V3'] }, optional: { model: [[ ]] } }, output: ['IMAGE'] } })
  await client.validate({ a: { class_type: 'Dynamic', inputs: { 'values.a': 1, model: 'fixture-managed.safetensors' } } })
  client.request = async () => ({ 'ComfyUI-PerfectVideoResolution': { input: { required: { resolution: [['WAN only']] } }, output: ['INT'] } })
  await client.validate({ a: { class_type: 'ComfyUI-PerfectVideoResolution', inputs: { resolution: 'Native — 864×1184' } } })
})

test('history output uses only the workflow final node and keeps review unverified', async () => {
  const client = new ComfyClient(base)
  const descriptor = { filename: 'final.mp4', subfolder: 'elysium/job', type: 'output' }
  const result = await collectVideoArtifacts(client, { outputs: { n126: { gifs: [descriptor] }, other: { gifs: [{ ...descriptor, filename: 'wrong.mp4' }] } } },
    { mode: 't2va', outputNode: 'n126', source: { path: 'source', sha256: 'a'.repeat(64) } }, 'prompt')
  assert.match(result.comfyui_view_url, /filename=final.mp4/)
  assert.equal(result.validation.human_review, 'not_run')
  assert.equal(result.comfyui_prompt_id, 'prompt')
})
