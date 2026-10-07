import test from 'node:test'
import assert from 'node:assert/strict'
import { bundledProductionPipelines, validateProductionPipeline } from '../../lib/production/pipeline-registry.js'

const fixture = () => structuredClone(bundledProductionPipelines().byId['novel-to-drama-text'])

test('bundled novel pipeline is a valid acyclic machine-readable contract', () => {
  const registry = bundledProductionPipelines()
  assert.deepEqual(registry.errors, [])
  assert.equal(registry.pipelines.length, 1)
  const pipeline = registry.byId['novel-to-drama-text']
  assert.deepEqual(pipeline.nodes.map(({ id }) => id), [
    'source-summary', 'story-reconcile', 'episode-plan', 'episode-script', 'asset-extraction', 'asset-prompt',
    'asset-commit', 'shot-plan', 'storyboard-prompt', 'video-prompt', 'shot-prompts-commit',
  ])
  assert.equal(pipeline.nodes.find(({ id }) => id === 'asset-extraction').concurrency, 1)
  assert.deepEqual(pipeline.nodes.find(({ id }) => id === 'shot-prompts-commit').dependsOn, ['storyboard-prompt', 'video-prompt'])
})

test('pipeline validation rejects unknown runtime bindings and invalid output schema refs', () => {
  for (const mutate of [
    (pipeline) => { pipeline.nodes[0].role = 'unknown' },
    (pipeline) => { pipeline.nodes[0].inputs = ['unknown'] },
    (pipeline) => { pipeline.nodes[0].validators = ['unknown'] },
    (pipeline) => { pipeline.nodes[0].commit.handler = 'unknown' },
    (pipeline) => { pipeline.nodes[0].outputSchema = 'production/novel-output.schema.json#/definitions/missing' },
  ]) {
    const pipeline = fixture()
    mutate(pipeline)
    const result = validateProductionPipeline(pipeline)
    assert.equal(result.ok, false)
    assert.ok(result.errors.length)
  }
})

test('pipeline validation rejects duplicate nodes, missing dependencies and cycles', () => {
  const duplicate = fixture()
  duplicate.nodes.push(structuredClone(duplicate.nodes[0]))
  assert.match(validateProductionPipeline(duplicate).errors.join('\n'), /唯一/)

  const missing = fixture()
  missing.nodes[1].dependsOn = ['missing']
  assert.match(validateProductionPipeline(missing).errors.join('\n'), /不存在/)

  const cyclic = fixture()
  cyclic.nodes[0].dependsOn = ['story-reconcile']
  assert.match(validateProductionPipeline(cyclic).errors.join('\n'), /循环/)
})

test('barriers cannot smuggle agent prompt or role fields', () => {
  const pipeline = fixture()
  const barrier = pipeline.nodes.find(({ kind }) => kind === 'barrier')
  barrier.role = 'story'
  barrier.prompt = { objective: 'bypass', constraints: [] }
  const result = validateProductionPipeline(pipeline)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /未知字段/)
})
