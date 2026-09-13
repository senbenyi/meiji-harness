import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { compileBundle, DIRECTORY, WORKFLOWS } from '../scripts/sync_runpod_video_workflows.mjs'

test('exactly five RunPod modes are packaged', async () => {
  assert.deepEqual(new Set(Object.keys(WORKFLOWS)), new Set(['t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va']))
  assert.deepEqual(new Set((await readdir(DIRECTORY)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))), new Set(Object.keys(WORKFLOWS)))
})

test('snapshots have complete API links and bindings', async () => {
  for (const mode of Object.keys(WORKFLOWS)) {
    const bundle = JSON.parse(await readFile(`${DIRECTORY}/${mode}.json`, 'utf8'))
    assert.equal(bundle.mode, mode)
    assert.doesNotMatch(JSON.stringify(bundle), /Qwen3\.5|AILab_QwenVL/)
    assert.ok(bundle.workflow.definitions.subgraphs.length)
    for (const container of [bundle.workflow, ...bundle.workflow.definitions.subgraphs]) {
      const ids = new Set(container.nodes.map(node => node.id))
      for (const link of container.links) {
        const [origin, target] = Array.isArray(link) ? [link[1], link[3]] : [link.origin_id, link.target_id]
        assert.ok(origin === -10 || ids.has(origin)); assert.ok(target === -20 || ids.has(target))
      }
    }
    assert.match(bundle.source.sha256, /^[0-9a-f]{64}$/)
    for (const node of Object.values(bundle.graph)) {
      for (const value of Object.values(node.inputs)) {
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string') assert.ok(bundle.graph[value[0]])
      }
    }
    for (const binding of [...bundle.bindings.prompt, ...Object.values(bundle.bindings.media), bundle.bindings.output]) {
      assert.ok(bundle.graph[binding.node]); assert.ok(binding.input in bundle.graph[binding.node].inputs)
    }
  }
})

test('Node compiler reproduces every frozen graph and binding', async () => {
  for (const mode of Object.keys(WORKFLOWS)) {
    const bundle = JSON.parse(await readFile(`${DIRECTORY}/${mode}.json`, 'utf8')), schemas = {}
    for (const node of Object.values(bundle.graph)) {
      const optional = schemas[node.class_type]?.input.optional || {}
      for (const name of Object.keys(node.inputs)) optional[name] ||= ['ANY']
      schemas[node.class_type] = { input: { optional } }
    }
    const compiled = compileBundle(mode, bundle.workflow, schemas, bundle.source.path, bundle.source.sha256)
    assert.deepEqual(compiled.graph, bundle.graph)
    assert.deepEqual(compiled.bindings, bundle.bindings)
  }
})
