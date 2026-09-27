import { setupModel } from './fixtures/model.js'
import { generateShotSeconds, generateShotStoryboard } from '../server/generate/shot-text.js'
import { scopeProjects } from '../server/data/episodes.js'
import { saveImageDraft } from '../server/data/pictures.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentSessionId, projectRefreshMark, sessionIdFromNode, sessionIdFromStorage } from '../client/chat-bridge.js'
import { episodeWork } from '../client/overview.js'
import { buildImageGraph } from '../server/generate/image.js'
import { describeOperation, runOperation, stageOperation, takeOperation, takePendingForSession } from '../server/flow/actions.js'
import { projectStore } from '../server/data/projects.js'

const look = '二十出头的中国青年男子，短黑发，皮肤晒黑，穿着旧外套，手里拎着鼓囊的编织袋'

test('the selected session row exposes its session id', () => {
  const node = { __reactFiber$x: { key: null, return: { key: 'session-438a7a11-3984-447d-88df-16d610f8e914', return: null } } }
  assert.equal(sessionIdFromNode(node), 'session-438a7a11-3984-447d-88df-16d610f8e914')
  assert.equal(sessionIdFromNode({}), '')
})

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

test('a panel instruction carries its operation id without unrelated identifiers', () => {
  const text = describeOperation({ id: 'op-1', action: 'image', itemId: 'A01', itemName: '傻根', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成图片/)
  assert.match(text, /operationId: op-1/)
  assert.match(text, /傻根/)
  assert.equal(/项目：|p1|A01/.test(text), false)
  assert.match(text, /必须传入上面的 operationId/)
})

test('a panel click requires its explicit id and owning session', () => {
  const sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
  const id = stageOperation({ action: 'storyboard', sessionId, projectId: 'p1' })
  assert.throws(() => takePendingForSession(sessionId), /operationId/)
  assert.throws(() => takeOperation(id, 'another-session'), /不属于当前会话/)
  const operation = takeOperation(id, sessionId)
  assert.equal(operation.id, id)
  assert.equal(operation.action, 'storyboard')
  assert.equal(takePendingForSession(sessionId), null)
})

test('a shot table review regenerates the whole table', () => {
  const text = describeOperation({ id: 'op-13', action: 'shots', review: '打架不要切这么碎', projectId: 'p1' })
  assert.match(text, /【极乐世界】写镜头表/)
  assert.match(text, /审核意见：打架不要切这么碎/)
  assert.match(text, /按这条意见重写整张镜头表/)
  assert.match(text, /函数：generateShots/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a shot revision names the shot and its review', () => {
  const text = describeOperation({ id: 'op-8', action: 'revise-shot', track: 'S03', review: '手要松开', projectId: 'p1' })
  assert.match(text, /【极乐世界】按审核意见重写镜头/)
  assert.match(text, /镜头 S03/)
  assert.match(text, /审核意见：手要松开/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a per-second click names the shot and its skill', () => {
  const text = describeOperation({ id: 'op-7', action: 'shot-seconds', track: 'S04', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成每秒指令/)
  assert.match(text, /镜头 S04/)
  assert.match(text, /skill-jingtou-meimiao-seconds-generate\.md/)
  assert.match(text, /函数：generateShotSeconds/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a per-shot storyboard names the shot and its skill', () => {
  const text = describeOperation({ id: 'op-10', action: 'shot-storyboard', track: 'S03', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成这一镜的分镜/)
  assert.match(text, /镜头 S03/)
  assert.match(text, /skill-jingtou-wenben-storyboard-generate\.md/)
  assert.match(text, /函数：generateShotStoryboard/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('generating all boards names both shot functions', () => {
  const text = describeOperation({ id: 'op-12', action: 'shot-boards', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成所有分镜/)
  assert.match(text, /逐镜调用每秒指令和文本分镜/)
  assert.match(text, /函数：generateShotSeconds/)
  assert.match(text, /函数：generateShotStoryboard/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a pencil click names the shot and its sheet', () => {
  const text = describeOperation({ id: 'op-11', action: 'pencil', track: 'S01', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成铅笔分镜/)
  assert.match(text, /镜头 S01/)
  assert.match(text, /每秒一格/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a film click names the tool, the skill, and the prompt', () => {
  const text = describeOperation({ id: 'op-9', action: 'film', track: '2', projectId: 'p1', prompt: '张飞睁眼' })
  assert.match(text, /【极乐世界】提交成片/)
  assert.match(text, /轨道 2/)
  assert.match(text, /文件：server\/generate\/film.js/)
  assert.match(text, /函数：submitH3/)
  assert.match(text, /工具：meiji_panel/)
  assert.match(text, /最终提交参数：/)
  assert.match(text, /model: elysium-video/)
  assert.match(text, /quality: medium/)
  assert.match(text, /prompt:\n张飞睁眼/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a revised still encodes the current image instead of an empty latent', () => {
  const graph = buildImageGraph({ prompt: look, seed: 3, width: 768, height: 1344, prefix: 'a', imageName: 'ref.png' })
  assert.equal(graph[5].inputs.denoise, 0.55)
  assert.deepEqual(graph[5].inputs.latent_image, ['9', 0])
  assert.equal(graph[8].inputs.image, 'ref.png')
})
const passText = text => async skill => skill === 'skill-gongyong-content-review' ? 'PASS' : text
const videoDeps = home => ({ home, submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: item.track })) }), retrieveFilm: async () => Buffer.from('video'), saveLastFrame: async () => Buffer.from('frame') })
test('batch boards write each shot without losing earlier results',async t=>{
 const e=await setupModel(t)
 await runOperation(e.op('shot-boards'),{home:e.home,generateShotSeconds:opts=>generateShotSeconds({...opts,request:passText('0–5s：朝北进入')}),generateShotStoryboard:opts=>generateShotStoryboard({...opts,request:passText('summary: 朝北进入\ndetailed_description: 摄影机在身后\noverall_soundscape: 风\nnon_diegetic_music: N/A')})})
 const p=await e.read();assert.equal(p.shots.items.length,2);for(const s of p.shots.items){assert.equal(s.seconds.status,'passed');assert.equal(s.storyboard.status,'passed')}
})
test('pencil generation is a draft and does not replace an active pencil',async t=>{const e=await setupModel(t);await runOperation(e.op('pencil',{track:'S01'}),{home:e.home,submitPencilBoard:async()=>saveImageDraft(e.home,Buffer.from('pencil'),'image/png','scenes','分镜',{projectId:e.id,episodeId:e.episodeId})});const p=await e.read();assert.equal(p.shots.items[0].pencil.content,null);assert.equal(Object.keys(p.pendingImages).length,1);assert.equal(p.shots.items[0].pencil.operation.phase,'awaiting-confirmation')})
test('one shot can generate video while other storyboards are absent',async t=>{const e=await setupModel(t);await scopeProjects(e.store,e.episodeId).save(e.id,p=>{p.shots.items[1].storyboard.content=null;return {shots:p.shots}});await runOperation(e.op('film',{track:'S01'}),videoDeps(e.home));for(let i=0;i<100;i++){const p=await e.read();if(p.shots.items[0].video.content?.status==='ready'){assert.equal(p.shots.items[0].video.status,'passed');return}await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('video did not finish')})
test('one-click video processes shots in order and preserves both clips',async t=>{const e=await setupModel(t),seen=[];const deps=videoDeps(e.home);await runOperation(e.op('films'),{...deps,submitH3:async input=>{seen.push(input.items[0].track);assert.match(input.items[0].prompt,/旅人朝北进入庭院/);return deps.submitH3(input)}});assert.deepEqual(seen,['S01','S02']);const p=await e.read();assert.ok(p.shots.items.every(s=>s.video.status==='passed'))})
test('first-frame mode refuses a missing previous completed video',async t=>{const e=await setupModel(t);await scopeProjects(e.store,e.episodeId).save(e.id,p=>{p.shots.items[1].storyboard.content.video='first_frame';return {shots:p.shots}});await assert.rejects(runOperation(e.op('film',{track:'S02'}),videoDeps(e.home)),/上一镜/)})
test('assembly uses shot order and writes a passed assembly model',async t=>{const e=await setupModel(t);await runOperation(e.op('films'),videoDeps(e.home));let inputs;await runOperation(e.op('assemble'),{home:e.home,concatFilms:async value=>{inputs=value.inputs}});assert.ok(inputs[0].endsWith((await e.read()).shots.items[0].video.content.file));assert.ok(inputs[1].endsWith((await e.read()).shots.items[1].video.content.file));assert.equal((await e.read()).assembly.status,'passed')})

test('group regeneration only replaces selected cards and retains outline and other group',async t=>{
 const e=await setupModel(t),before=await e.read()
 await runOperation(e.op('scenes',{review:'场景更开阔'}),{home:e.home,regenerateCardGroup:async()=>({items:before.plot.scenes.items.map(s=>({...s,space:'更开阔的空间'})),check:{passed:true,failures:[]}})})
 const after=await e.read();assert.deepEqual(after.plot.characters,before.plot.characters);assert.deepEqual(after.plot.outline,before.plot.outline);assert.equal(after.plot.scenes.items[0].space,'更开阔的空间')
})
test('scene text edit preserves image and rejects stale original',async t=>{
 const e=await setupModel(t),before=await e.read(),scene=before.plot.scenes.items[0]
 const original=Object.fromEntries(['name','landmark','light','space','look'].map(k=>[k,scene[k]]))
 const fields={name:scene.name,landmark:'北墙',light:'月光',space:'更开阔的庭院',look:scene.look}
 await runOperation(e.op('scene-text',{itemId:scene.id,original,fields}),{home:e.home,reviewContent:async()=>({passed:true,failures:[]})})
 const after=await e.read();assert.equal(after.plot.scenes.items[0].space,fields.space);assert.deepEqual(after.plot.scenes.items[0].image,scene.image)
 await assert.rejects(runOperation(e.op('scene-text',{itemId:scene.id,original,fields}),{home:e.home}),/已更新/)
})
