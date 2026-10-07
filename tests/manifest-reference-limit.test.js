import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGraphFromManifest } from '../lib/manifest.js'
import { limitReferenceIds } from '../lib/prompts/compiler.js'

test('image injection honors the manifest reference maximum', () => {
  const manifest = {
    id: 'reference-limit',
    displayName: 'Reference limit',
    capability: 'video.reference2video',
    graph: { '5': { class_type: 'Video', inputs: {} } },
    params: {
      refs: {
        inject: 'image',
        via: 'field',
        to: { node: '5', field: 'ref_images.ref_image_${i}' },
        max: 2,
      },
    },
    output: { node: '5', mediaType: 'video' },
  }
  const graph = buildGraphFromManifest(manifest, { refs: ['one.png', 'two.png', 'three.png'] })
  assert.deepEqual(graph['5'].inputs, {
    'ref_images.ref_image_0': 'one.png',
    'ref_images.ref_image_1': 'two.png',
  })
})

test('reference selection preserves the final storyboard within the budget', () => {
  assert.deepEqual(limitReferenceIds(['character', 'location', 'prop', 'storyboard'], 3), [
    'character',
    'location',
    'storyboard',
  ])
})
