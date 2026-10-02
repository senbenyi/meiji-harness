import test from 'node:test'
import assert from 'node:assert/strict'
test('official reference prompt keeps subject definitions and validates picture indices', async () => {
  const { bindReferencePrompt } = await import('../shared/video-rules.js')
  const text = 'subject_definitions: <Subject 1> is the person in <Picture 1>.\nsummary: [reference generation] <Subject 1> walks.\nretention_analysis: <Subject 1>: fully_preserved.\ndetailed_description: [Shot 1] <Subject 1> walks left.\noverall_soundscape: Wind.\nnon_diegetic_music: None.'
  assert.equal(bindReferencePrompt(text, [{ name: 'Person' }]), text)
  assert.throws(() => bindReferencePrompt(text, []), /H3 text/)
  assert.throws(() => bindReferencePrompt(text, [{}, {}]), /编号/)
})
