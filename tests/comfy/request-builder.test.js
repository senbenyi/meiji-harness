import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkflowRequest } from '../../lib/comfy/request-builder.js'

test('request builder applies confirmed semantic bindings without mutating source workflow', () => {
  const workflow = {
    1: { class_type: 'CLIPTextEncode', inputs: { text: 'old' } },
    2: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    3: { class_type: 'LoadImage', inputs: { image: 'old.png' } },
  }
  const bindings = {
    positivePrompt: [{ nodeId: '1', input: 'text' }],
    width: [{ nodeId: '2', input: 'width' }],
    height: [{ nodeId: '2', input: 'height' }],
    referenceImages: [{ nodeId: '3', input: 'image', slot: 0 }],
  }
  const first = buildWorkflowRequest({ workflow, bindings, snapshot: { prompt: 'new', parameters: { width: 768, height: 432 } }, mediaInputs: ['ref.png'] })
  const second = buildWorkflowRequest({ workflow, bindings, snapshot: { prompt: 'new', parameters: { width: 768, height: 432 } }, mediaInputs: ['ref.png'] })
  assert.equal(first.workflowHash, second.workflowHash)
  assert.equal(first.graph['1'].inputs.text, 'new')
  assert.equal(first.graph['2'].inputs.width, 768)
  assert.equal(first.graph['3'].inputs.image, 'ref.png')
  assert.equal(workflow['1'].inputs.text, 'old')
})
