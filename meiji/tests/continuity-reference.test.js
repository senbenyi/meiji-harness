import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { generateShotStoryboard } from '../server/generate/shot-text.js'
import { prepareFilmOpening, filmSubmit, runOperation } from '../server/flow/operations/run.js'
import { setContent } from '../shared/drama-model.js'

test('storyboard gets episode and neighbor context without model metadata and strips continuity protocol', async () => {
  const p = episodeFixture()
  p.plot.characters.items[0].draft = { text: 'SECRET_METADATA' }
  p.plot.characters.items[0].image.content = { localPath: '/plugins/meiji/asset-file?category=characters&id=person' }
  let instructions
  const rows = await generateShotStoryboard({ project: p, shotId: 'S02', request: async ({ skill, user: text }) => {
    if (skill === 'review') return 'PASS'
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
 p.shots.items[0].tailFrame={status:'passed',content:{sourceVideoFile:'version.mp4',localPath:'/films/version-last.png'}}
 p.shots.items[1].scene='新场景'
 const result=await generateShotStoryboard({project:p,shotId:'S02',request:async({ skill, user: text })=>{
  if(skill==='review')return 'PASS'
  assert.match(text,/<Picture 1> 上一镜 S01 尾帧/)
  assert.doesNotMatch(text,/tail-frame|version-last|base64/)
  return '[opening-reference: none]\n使用 <Picture 1> 作为上一镜视觉参考，本镜转入新场景'
 }})
 assert.equal(result[1].referenceSnapshot[0].url,'tail-frame:version.mp4')
 assert.deepEqual(result[1].tailReference,{sourceShotId:'S01',sourceVideoFile:'version.mp4'})
 assert.equal(result[1].tailReference.sourceVideoFile,'version.mp4')
})

test('first shot cannot request a previous tail even when the model asks for it', async () => {
  const p = episodeFixture()
  p.plot.characters.items[0].image.content = { localPath: '/plugins/meiji/asset-file?category=characters&id=person' }
  const rows = await generateShotStoryboard({ project: p, shotId: 'S01', request: async ({ skill }) => skill === 'review' ? 'PASS' : '[opening-reference: previous-tail]\n提示词' })
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

test('changing shot references keeps downstream invalidation instead of restoring old renders', async t => {
  const e = await setupModel(t)
  setContent(e.episode.shots.items[0].video, { status: 'ready', url: 'https://test/video' }, { passed: true, failures: [] })
  setContent(e.episode.shots.items[0].pencil, { localPath: '/plugins/meiji/asset-file?category=scenes&id=pencil', url: '/plugins/meiji/asset-file?category=scenes&id=pencil' }, { passed: true, failures: [] })
  await e.store.save(e.id, { episodes: [e.episode] })
  await runOperation({ ...e.op('shot-assets'), track: 'S01', characterIds: ['C01'], sceneId: 'E01' }, { home: e.home })
  const p = await e.read()
  assert.equal(p.shots.items[0].storyboard.stale, true)
  assert.equal(p.shots.items[0].storyboard.check.passed, null)
  assert.equal(p.shots.items[0].video.content, null)
  assert.equal(p.shots.items[0].pencil.content, null)
  assert.equal(p.assembly.content, null)
})
