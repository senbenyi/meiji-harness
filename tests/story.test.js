import test from 'node:test'
import assert from 'node:assert/strict'
import { outlineDurationError } from '../server/generate/story.js'

test('an outline stays within ten seconds of the episode', () => {
  assert.equal(outlineDurationError('（50秒）甲推门。\n（40秒）甲进门。', 90), '')
  assert.match(outlineDurationError('（50秒）甲推门。', 90), /相差超过 10 秒/)
  assert.match(outlineDurationError('甲推门。', 90), /没有写出每段秒数/)
})

test('official reference prompt keeps subject definitions and validates picture indices', async () => {
  const { bindReferencePrompt } = await import('../server/generate/film.js')
  const text = 'subject_definitions: <Subject 1> is the person in <Picture 1>.\nsummary: [reference generation] <Subject 1> walks.\nretention_analysis: <Subject 1>: fully_preserved.\ndetailed_description: [Shot 1] <Subject 1> walks left.\noverall_soundscape: Wind.\nnon_diegetic_music: None.'
  assert.equal(bindReferencePrompt(text, [{ name: 'Person' }]), text)
  assert.throws(() => bindReferencePrompt(text, []), /H3 text/)
  assert.throws(() => bindReferencePrompt(text, [{}, {}]), /编号/)
})
