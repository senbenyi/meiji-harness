import test from 'node:test'
import assert from 'node:assert/strict'
import { compilePromptSnapshot } from '../../lib/prompts/compiler.js'
import { createProjectAggregate } from '../../lib/domain/spec.js'

function fixture() {
  const project = createProjectAggregate({ id: 'project-1' })
  project.revision = 7
  project.storyBible = { id: 'bible-1', visualStyle: 'cinematic noir' }
  project.characters['char-1'] = { id: 'char-1', name: 'Luna', appearance: 'silver bob haircut' }
  project.assets['asset-1'] = { id: 'asset-1', status: 'approved', contentHash: 'asset-hash' }
  project.shots['shot-1'] = {
    id: 'shot-1', prompt: 'Luna enters the room', negativePrompt: 'blur',
    referenceBindings: [{ kind: 'character', entityId: 'char-1', assetId: 'asset-1', role: 'subject', required: true }],
  }
  return project
}

test('prompt snapshot is deterministic and resolves stable references', () => {
  const project = fixture()
  const input = { project, shotId: 'shot-1', capability: 'image.text2image', tier: 'quality', parameters: { seed: 42 } }
  const first = compilePromptSnapshot(input)
  const second = compilePromptSnapshot(input)
  assert.equal(first.snapshotHash, second.snapshotHash)
  assert.match(first.prompt, /cinematic noir/)
  assert.match(first.prompt, /silver bob haircut/)
  assert.deepEqual(first.references[0], {
    kind: 'character', entityId: 'char-1', role: 'subject', required: true,
    assetId: 'asset-1', assetHash: 'asset-hash',
  })
})

test('required references reject missing or unapproved assets before submission', () => {
  const project = fixture()
  project.assets['asset-1'].status = 'candidate'
  assert.throws(
    () => compilePromptSnapshot({ project, shotId: 'shot-1', capability: 'image.text2image' }),
    /reference asset must be approved/,
  )
})
