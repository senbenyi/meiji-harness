import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { applyCommand } from '../../lib/domain/commands/index.js'
import { createProjectAggregate } from '../../lib/domain/spec.js'
import { compilePromptSnapshot } from '../../lib/prompts/compiler.js'
import { validatePromptSnapshot } from '../../lib/prompts/snapshot.js'
import { authoredGeneration } from '../../lib/prompts/specification.js'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function formalProject() {
  const project = createProjectAggregate({ id: 'prompt-snapshot-concurrency' })
  project.sourceDocuments.source = { id: 'source' }
  project.episodes.ep = { id: 'ep', script: '生日夜聚餐', sourceSpans: [], analysisProposalId: 'analysis' }
  const shot = {
    id: 'shot-1', episodeId: 'ep', name: '镜头一', description: '众人聚餐', shotDescription: '众人聚餐',
    duration: 6, audioDialogue: '', audioNotes: '', referenceBindings: [], status: 'ready', attemptIds: [],
  }
  project.shots[shot.id] = shot
  shot.imageGeneration = authoredGeneration(project, shot, 'image', {
    prompt: '众人围桌聚餐', negativePrompt: '',
    details: { subject: '众人', appearance: '正式造型', composition: '中景', lighting: '暖光', style: '写实', constraints: '保持角色一致' },
  }, null, 'storyboard')
  return project
}

function snapshot(project) {
  return compilePromptSnapshot({
    project, shotId: 'shot-1', capability: 'image.image2image', target: { kind: 'storyboard', id: 'shot-1' },
    parameters: { referenceIds: [], referenceLimit: 10 },
  })
}

test('unrelated project revision changes do not invalidate a prompt snapshot', () => {
  const project = formalProject()
  const inputSnapshot = snapshot(project)
  project.revision += 1

  assert.equal(snapshot(project).snapshotHash, inputSnapshot.snapshotHash)
  assert.doesNotThrow(() => applyCommand(project, 'createGenerationAttempt', {
    shotId: 'shot-1', capability: 'image.image2image', attemptId: 'attempt-1', inputSnapshot,
  }, { commandId: 'create-attempt' }))
})

test('authored prompt changes still invalidate a prompt snapshot', () => {
  const project = formalProject()
  const inputSnapshot = snapshot(project)
  project.shots['shot-1'].imageGeneration = authoredGeneration(project, project.shots['shot-1'], 'image', {
    prompt: '龙哥独自站在窗前', negativePrompt: '',
    details: { subject: '龙哥', appearance: '正式造型', composition: '中景', lighting: '冷光', style: '写实', constraints: '保持角色一致' },
  }, null, 'storyboard')

  assert.throws(() => applyCommand(project, 'createGenerationAttempt', {
    shotId: 'shot-1', capability: 'image.image2image', attemptId: 'attempt-1', inputSnapshot,
  }, { commandId: 'create-attempt' }), /提示词快照与当前已保存的生成依据不一致/)
})

test('schema v1 snapshots remain verifiable without weakening their revision-bound hash', () => {
  const legacy = {
    schemaVersion: 1, projectRevision: 3, shotId: 'shot-1', prompt: '旧提示词', negativePrompt: '',
    references: [], parameters: {}, capabilityKey: 'image.image2image:fast', workflowFingerprint: 'legacy',
    target: { kind: 'storyboard', id: 'shot-1' },
  }
  const snapshotHash = createHash('sha256').update(canonical(legacy)).digest('hex')

  assert.equal(validatePromptSnapshot({ ...legacy, snapshotHash }).schemaVersion, 1)
  assert.throws(() => validatePromptSnapshot({ ...legacy, projectRevision: 4, snapshotHash }), /prompt snapshot hash mismatch/)
})
