import test from 'node:test'
import assert from 'node:assert/strict'
import { compilePromptSnapshot, limitReferenceIds } from '../../lib/prompts/compiler.js'
import { authoredGeneration } from '../../lib/prompts/specification.js'
import { createProjectAggregate } from '../../lib/domain/spec.js'

function formalProject(referenceCount = 11) {
  const project = createProjectAggregate({ id: 'reference-limit' })
  project.sourceDocuments.source = { id: 'source' }
  project.episodes.ep = { id: 'ep', script: '生日夜聚餐', sourceSpans: [], analysisProposalId: 'analysis' }
  const shot = {
    id: 'shot-1', episodeId: 'ep', name: '镜头一', description: '众人聚餐',
    shotDescription: '众人聚餐', duration: 6, audioDialogue: '', audioNotes: '',
    referenceBindings: [],
  }
  for (let index = 1; index <= referenceCount; index += 1) {
    const entityId = `character-${index}`
    const assetId = `asset-${index}`
    project.characters[entityId] = { id: entityId, name: `角色${index}`, referenceAssetId: assetId }
    project.assets[assetId] = { id: assetId, kind: 'image', status: 'approved', contentHash: `hash-${index}` }
    shot.referenceBindings.push({ kind: 'character', entityId, required: true })
  }
  project.shots[shot.id] = shot
  shot.imageGeneration = authoredGeneration(project, shot, 'image', {
    prompt: '众人围桌聚餐', negativePrompt: '',
    details: { subject: '众人', appearance: '正式造型', composition: '中景', lighting: '暖光', style: '写实', constraints: '保持角色一致' },
  }, null, 'storyboard')
  return project
}

test('image prompt validation uses the same reference budget as the renderer', () => {
  const project = formalProject(11)
  const complete = Object.values(project.characters).map((item) => item.referenceAssetId)
  const submitted = limitReferenceIds(complete, 10)
  const snapshot = compilePromptSnapshot({
    project, shotId: 'shot-1', capability: 'image.image2image', target: { kind: 'storyboard', id: 'shot-1' },
    parameters: { referenceIds: submitted, referenceLimit: 10 },
  })

  assert.deepEqual(snapshot.parameters.referenceIds, submitted)
  assert.equal(snapshot.parameters.referenceIds.length, 10)
  assert.equal(snapshot.parameters.referenceIds.at(-1), 'asset-11')
})

test('image prompt validation still rejects a reordered provider-facing list', () => {
  const project = formalProject(11)
  const complete = Object.values(project.characters).map((item) => item.referenceAssetId)
  const submitted = limitReferenceIds(complete, 10).reverse()

  assert.throws(() => compilePromptSnapshot({
    project, shotId: 'shot-1', capability: 'image.image2image', target: { kind: 'storyboard', id: 'shot-1' },
    parameters: { referenceIds: submitted, referenceLimit: 10 },
  }), /实际参考图片必须完整且按绑定顺序提交/)
})
