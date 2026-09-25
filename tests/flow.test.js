import test from 'node:test'
import assert from 'node:assert/strict'
import { canGenerate, gateOf, replaceFrom, sourcePatch } from '../server/flow/gates.js'

const base = {
  title: '天下无贼',
  durationSeconds: 6,
  summary: '摘要',
  status: 'in-progress',
}
const brief = { logline: '一句话', style: 'live-action cinematic', audience: '观众', promise: '记住这一下' }

test('an episode summary opens the outline before a brief exists', () => {
  assert.equal(gateOf(base), 'outline')
  assert.equal(canGenerate(base, 'outline'), true)
  const bare = { ...base, summary: '' }
  assert.equal(gateOf(bare), 'brief')
  assert.equal(canGenerate(bare, 'outline'), false)
})

test('brief waits for review before the outline', () => {
  const project = { ...base, ...replaceFrom(base, 'brief', { brief }) }
  assert.equal(project.stage, 'brief')
  assert.equal(project.outline, null)
  assert.equal(canGenerate(project, 'outline'), true)
  assert.equal(canGenerate(project, 'characters'), false)
})

test('shot self-check blocks the text storyboard', () => {
  const project = {
    ...base,
    brief,
    outline: '大纲',
    characters: { items: [{ id: 'C01' }] },
    scenes: { items: [{ id: 'E01' }] },
    shots: { items: [{ id: 'S01', duration: 6 }], check: { passed: false, failures: ['开场镜需要强 Hook'] } },
    reviews: { brief: 'approved', outline: 'approved', characters: 'approved', scenes: 'approved', shots: 'pending', storyboard: 'pending', film: 'pending' },
  }
  assert.equal(gateOf(project), 'shots')
  const ready = { ...project, feedback: { shots: { check: { passed: true, failures: [] }, review: { status: 'pending', text: '' } } } }
  assert.equal(canGenerate(ready, 'storyboard'), true)
  const detailed = { ...ready, shots: { ...ready.shots, items: [{ id: 'S01', duration: 6, seconds: Array(6).fill({}) }] } }
  assert.equal(canGenerate(detailed, 'storyboard'), true)
  assert.equal(canGenerate(detailed, 'characters'), true)
  assert.equal(canGenerate(detailed, 'film'), false)
  const boarded = { ...detailed, storyboard: [{ id: 'S01' }] }
  assert.equal(canGenerate(boarded, 'film'), true)
})

test('changing the summary resets the brief and later steps', () => {
  const project = {
    ...base,
    summary: '旧摘要',
    brief,
    outline: '旧大纲',
    reviews: { brief: 'approved', outline: 'pending', characters: 'pending', scenes: 'pending', shots: 'pending', storyboard: 'pending', film: 'pending' },
    stage: 'outline',
  }
  assert.deepEqual(sourcePatch(project, { title: '新标题', summary: '旧摘要' }), { summary: '旧摘要', title: '新标题' })
  const rewritten = sourcePatch(project, { summary: '新摘要' })
  assert.equal(rewritten.summary, '新摘要')
  assert.equal(rewritten.brief, null)
  assert.equal(rewritten.outline, null)
  assert.equal(rewritten.stage, 'brief')
  assert.throws(() => sourcePatch(project, { summary: '旧摘要', aspectRatio: '21:9' }), { status: 400 })
})
