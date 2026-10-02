import test from 'node:test'
import assert from 'node:assert/strict'
import { compileH3Prompt, compilePromptSnapshot } from '../../lib/prompts/compiler.js'
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

test('video reference prompt is compiled to deterministic H3 Ref2VA sections', () => {
  const project = fixture()
  const snapshot = compilePromptSnapshot({
    project,
    shotId: 'shot-1',
    capability: 'video.reference2video',
    tier: 'quality',
  })
  for (const section of ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']) {
    assert.match(snapshot.prompt, new RegExp(`(^|\\n)${section}:`, 'm'))
  }
  assert.match(snapshot.prompt, /<Subject 1>/)
  assert.match(snapshot.prompt, /silver bob haircut/)
})

test('already structured H3 prompt is preserved and I2V gets alignment contract', () => {
  const structured = `subject_definitions:
x
summary:
x
retention_analysis:
x
detailed_description:
x
overall_soundscape:
x
non_diegetic_music:
N/A`
  assert.equal(compileH3Prompt({ capability: 'video.reference2video', prompt: structured }), structured)
  const i2v = compileH3Prompt({ capability: 'video.image2video', prompt: 'A woman turns toward the gate.' })
  assert.match(i2v, /^For the target video/)
  assert.match(i2v, /integrated_multimodal_description:/)
})
