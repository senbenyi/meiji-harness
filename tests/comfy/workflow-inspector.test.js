import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectWorkflow } from '../../lib/capabilities/workflow-inspector.js'

test('inspector finds explicit prompt, size, seed, reference and output bindings', () => {
  const workflow = {
    1: { class_type: 'CLIPTextEncode', _meta: { title: 'Positive Prompt' }, inputs: { text: 'old' } },
    2: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    3: { class_type: 'KSampler', inputs: { seed: 1 } },
    4: { class_type: 'LoadImage', inputs: { image: 'ref.png' } },
    5: { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
  }
  const result = inspectWorkflow(workflow)
  assert.equal(result.bindingStatus, 'confirmed')
  assert.deepEqual(result.bindings.positivePrompt, [{ nodeId: '1', input: 'text' }])
  assert.equal(result.capabilities.adjustableSize, true)
  assert.equal(result.capabilities.referenceImages, 1)
  assert.deepEqual(result.capabilities.outputTypes, ['image'])
})

test('inspector reports ambiguous unlabeled text nodes instead of guessing', () => {
  const result = inspectWorkflow({
    1: { class_type: 'CLIPTextEncode', inputs: { text: 'one' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'two' } },
  })
  assert.equal(result.bindingStatus, 'suggested')
  assert.equal(result.ambiguities[0].semantic, 'positivePrompt')
  assert.equal(result.ambiguities[0].candidates.length, 2)
})
