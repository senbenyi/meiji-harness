import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { generateShotStoryboard } from '../server/generate/shot-text.js'
import { prepareFilmOpening, filmSubmit } from '../server/flow/operations/run.js'

test('storyboard gets episode and neighbor context without model metadata and strips continuity protocol', async () => {
  const p = episodeFixture()
  p.plot.characters.items[0].draft = { text: 'SECRET_METADATA' }
  p.plot.characters.items[0].image.content = { imageUrl: 'https://test/person' }
  let instructions
  const rows = await generateShotStoryboard({ project: p, shotId: 'S02', request: async ({ skill, user: text }) => {
    if (skill === 'skill-gongyong-content-review') return 'PASS'
    instructions = text
    return '[opening-reference: previous-tail]\nsummary: 沿前镜继续'
  } })
  assert.match(instructions, /本集摘要/)
  assert.match(instructions, /## S01 \/ 5s/)
  assert.match(instructions, /摄影机位于身后/)
  assert.doesNotMatch(instructions, /SECRET_METADATA/)
  assert.equal(rows[1].openingReference, 'previous-tail')
  assert.equal(rows[1].prompt.text, 'summary: 沿前镜继续')
})

test('stored tail is included across scene changes without uploading during generation', async () => {
 const p=episodeFixture()
 p.shots.items[0].video.content={status:'ready',file:'version.mp4'}
 p.shots.items[0].tailFrame={status:'passed',content:{sourceVideoFile:'version.mp4',imageUrl:'https://test/tail'}}
 p.shots.items[1].scene='新场景'
 const result=await generateShotStoryboard({project:p,shotId:'S02',request:async({ skill, user: text })=>{
  if(skill==='skill-gongyong-content-review')return 'PASS'
  assert.match(text,/https:\/\/test\/tail/)
  return '[opening-reference: none]\n使用 <Picture 1> 作为上一镜视觉参考，本镜转入新场景'
 }})
 assert.equal(result[1].referenceSnapshot[0].url,'https://test/tail')
 assert.equal(result[1].tailReference.sourceVideoFile,'version.mp4')
})

test('first shot cannot request a previous tail even when the model asks for it', async () => {
  const p = episodeFixture()
  p.plot.characters.items[0].image.content = { imageUrl: 'https://test/person' }
  const rows = await generateShotStoryboard({ project: p, shotId: 'S01', request: async ({ skill }) => skill === 'skill-gongyong-content-review' ? 'PASS' : '[opening-reference: previous-tail]\n提示词' })
  assert.equal(rows[0].openingReference, 'none')
  assert.equal(rows[0].prompt.text, '提示词')
})

test('a known scene transition does not upload the previous scene tail', async () => {
  const p = episodeFixture()
  p.shots.items[0].scene = '走廊'
  p.shots.items[1].scene = '天台'
  const item = { ...p.shots.items[1].storyboard.content, id: 'S02', video: 'reference', openingReference: 'previous-tail' }
  let uploaded = false
  assert.deepEqual(await prepareFilmOpening(p, item, { home: '/unused', projects: {}, route: {}, deps: { uploadGatewayFile: async () => { uploaded = true } } }), {})
  assert.equal(uploaded, false)
})
