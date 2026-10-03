import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass } from './fixtures/review-result.js'
import { storyboardFixture } from './fixtures/storyboard.js'
import { setupModel } from './fixtures/model.js'
import { generateAllSeconds } from './fixtures/seconds-generation.js'
import { generateShotSeconds } from '../server/flow/tasks/text/task-shot-seconds.js'
import { generateShotStoryboard } from '../server/flow/tasks/text/task-storyboard-prompt.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { saveImageDraft } from '../server/data/image-storage.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentSessionId, projectRefreshMark, sessionIdFromStorage } from '../client/chat-bridge.js'
import { episodeWork } from '../client/project-overview-view.js'
import { runOperation } from './fixtures/operation.js'
import { projectStore } from '../server/data/project-store.js'

const look = '二十出头的中国青年男子，短黑发，皮肤晒黑，穿着旧外套，手里拎着鼓囊的编织袋'

test('the current session is read from storage when the sidebar row is gone', () => {
  const sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
  const storage = { getItem: () => JSON.stringify({ sessionId }) }
  assert.equal(sessionIdFromStorage(storage), sessionId)
  assert.equal(sessionIdFromStorage({ getItem: () => '{"sessionId":"nope"}' }), '')
  const doc = {
    querySelector: () => null,
    defaultView: { localStorage: storage },
  }
  assert.equal(currentSessionId(doc), sessionId)
})

test('panel follows the latest selection even while the sidebar still shows the old session', () => {
  let sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
  const oldSession = sessionId
  const doc = {
    querySelector: () => ({ __reactFiber$x: { key: oldSession, return: null } }),
    defaultView: { localStorage: { getItem: () => JSON.stringify({ sessionId }) } },
  }
  assert.equal(currentSessionId(doc), oldSession)
  sessionId = 'session-46eb0a51-3955-41c1-989c-2f541b1a05e8'
  assert.equal(currentSessionId(doc), sessionId)
})

const passText = text => async ({ skill, user }) => skill === 'review' ? reviewPass : skill==='storyboard'?storyboardFixture(user):text
const videoDeps = home => ({ home, submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: item.track })) }), retrieveGatewayVideo: async () => Buffer.from('video'), saveLastFrame: async () => Buffer.from('frame') })


test('one shot can generate video while other storyboards are absent',async t=>{const e=await setupModel(t);await scopeProjects(e.store,e.episodeId).save(e.id,p=>{p.shots.items[1].storyboard.content=null;return {shots:p.shots}});await runOperation(e.op('film',{track:'S01'}),{...videoDeps(e.home),waitForBackground:true});const p=await e.read();assert.equal(p.shots.items[0].video.content?.status,'ready');assert.equal(p.shots.items[0].video.status,'passed')})
test('one-click video processes shots in order and preserves both clips',async t=>{const e=await setupModel(t),seen=[];const deps=videoDeps(e.home);await runOperation(e.op('film', { ...{}, parts: 'video' }),{...deps,submitH3:async input=>{seen.push(input.items[0].track);assert.match(input.items[0].prompt,/旅人朝北进入庭院/);return deps.submitH3(input)}});assert.deepEqual(seen,['S01','S02']);const p=await e.read();assert.ok(p.shots.items.every(s=>s.video.status==='passed'))})
test('first-frame mode refuses a missing previous completed video',async t=>{const e=await setupModel(t);await scopeProjects(e.store,e.episodeId).save(e.id,p=>{p.shots.items[1].storyboard.content.video='first_frame';return {shots:p.shots}});await assert.rejects(runOperation(e.op('film',{track:'S02',parts:'video'}),videoDeps(e.home)),/上一镜/)})
test('assembly uses shot order and writes a passed assembly model',async t=>{const e=await setupModel(t);await runOperation(e.op('film', { ...{}, parts: 'video' }),videoDeps(e.home));let inputs;await runOperation(e.op('assemble'),{home:e.home,concatFilms:async value=>{inputs=value.inputs}});assert.ok(inputs[0].endsWith((await e.read()).shots.items[0].video.content.file));assert.ok(inputs[1].endsWith((await e.read()).shots.items[1].video.content.file));assert.equal((await e.read()).assembly.status,'passed')})

test('group regeneration only replaces selected cards and retains outline and other group',async t=>{
 const e=await setupModel(t),before=await e.read()
 await runOperation(e.op('story', { ...{review:'场景更开阔'}, only: 'scenes' }),{home:e.home,regenerateCardGroup:async()=>({items:before.plot.scenes.items.map(s=>({...s,space:'更开阔的空间'})),check:{passed:true,failures:[]}})})
 const after=await e.read();assert.deepEqual(after.plot.characters,before.plot.characters);assert.deepEqual(after.plot.outline,before.plot.outline);assert.equal(after.plot.scenes.items[0].space,'更开阔的空间')
})
test('character text edit keeps the picture and writes values without prompt keys',async t=>{
 const e=await setupModel(t),before=await e.read(),character=before.plot.characters.items[0]
 const { characterFieldValues, characterFactText } = await import('../shared/character-facts.js')
 const original=characterFieldValues(character)
 const fields={...original,name:'武松',gender:'男'}
 await runOperation(e.op('character-text',{itemId:character.id,original,fields}),{home:e.home,reviewContent:async()=>({passed:true,failures:[]})})
 const after=await e.read(),saved=after.plot.characters.items[0]
 assert.equal(saved.name,'武松');assert.equal(saved.gender,'男');assert.equal(saved.image.content,character.image.content)
 assert.equal(after.shots.items[0].cast[0],'武松')
 assert.deepEqual(after.shots.items[0].storyboard.content.characters,['武松'])
 assert.match(characterFactText(saved),/^中国，武松，/)
 assert.equal(/姓名：|性别：/.test(characterFactText(saved)),false)
 assert.equal(saved.costume,'长衣')
 assert.match(saved.look,/服装：长衣/)
 await assert.rejects(runOperation(e.op('character-text',{itemId:character.id,original,fields}),{home:e.home}),/已更新/)
})
test('scene text edit preserves image and rejects stale original',async t=>{
 const e=await setupModel(t),before=await e.read(),scene=before.plot.scenes.items[0]
 const original=Object.fromEntries(['name','landmark','light','space','look'].map(k=>[k,scene[k]]))
 const fields={name:scene.name,landmark:'北墙',light:'月光',space:'更开阔的庭院',look:scene.look}
 await runOperation(e.op('scene-text',{itemId:scene.id,original,fields}),{home:e.home,reviewContent:async()=>({passed:true,failures:[]})})
 const after=await e.read();assert.equal(after.plot.scenes.items[0].space,fields.space);assert.deepEqual(after.plot.scenes.items[0].image,scene.image)
 await assert.rejects(runOperation(e.op('scene-text',{itemId:scene.id,original,fields}),{home:e.home}),/已更新/)
})
