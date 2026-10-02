import { secondsResponse } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import { storyboardFixture } from './fixtures/storyboard.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateShots, generateShotSeconds, generateShotStoryboard, reviseShot } from '../server/flow/operations/shot-operations.js'
import { episodeFixture } from './fixtures/model.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { clearShotDownstream } from '../shared/project-rules.js'
const ask = (text, verdict=reviewPass) => async ({ skill, user }) => skill==='review'?verdict:skill==='seconds'?secondsResponse([['S01',5,text]]):text
const table='## S01 / 3s\n旅人朝北走进庭院。\n\n## S02 / 7s\n旅人停下。'
test('model can choose unequal boundaries and prose remains verbatim',async()=>{const p=episodeFixture();const out=await generateShots({project:p,request:ask(table)});assert.deepEqual(out.items.map(s=>s.duration),[3,7]);assert.equal(out.items[0].content,'旅人朝北走进庭院。');assert.equal(out.check.passed,true);assert.equal(out.failedOutput,'')})
// 格式错误归入程序自审，一次修订仍错误时不发布。
for(const raw of ['不是标题','{"items":[]}','## S01 / 16s\n过长'])test(`invalid boundary fails review after one revision: ${raw}`,async()=>{let calls=0;await assert.rejects(generateShots({project:episodeFixture(),request:async ({ skill: s }) =>{calls++;return s==='review'?reviewPass:raw}}),/镜头表需按|S01 的编号/);assert.equal(calls,4)})
test('duration mismatch keeps generated shots',async()=>{const p=episodeFixture();p.durationSeconds=60;const out=await generateShots({project:p,request:ask(table)});assert.equal(out.items.length,2);assert.equal(out.check.passed,false)})
test('semantic review failure after one correction retains generated text',async()=>{const out=await generateShots({project:episodeFixture(),request:ask(table,reviewFail('缺少原因'))});assert.equal(out.items.length,2);assert.deepEqual(out.check.failures,['位置：本次内容；原因：缺少原因；修正要求：修正上述问题'])})
test('review network failure stops without a new verdict',async()=>{await assert.rejects(generateShots({project:episodeFixture(),request:async ({ skill: s }) =>{if(s==='review')throw new Error('network');return table}}),/network/)})
test('seconds remain free text and only target shot changes',async()=>{const p=episodeFixture();const out=await generateShotSeconds({project:p,shotId:'S01',request:ask('0–5s 保持朝向')});assert.equal(out.items[0].seconds.content.beats[0].action,'0–5s 保持朝向');assert.equal(out.items[0].seconds.check.passed,true);assert.deepEqual(out.items[1],p.shots.items[1])})
test('single shot revision preserves selected cast and other shots',async()=>{const p=episodeFixture();const out=await reviseShot({project:p,shotId:'S01',review:'保持方向',request:ask('新的内容')});assert.equal(out.items[0].content,'新的内容');assert.deepEqual(out.items[0].cast,p.shots.items[0].cast);assert.deepEqual(out.items[1],p.shots.items[1])})
test('storyboard snapshot fixes the actual picture order and mode',async()=>{const p=episodeFixture();p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=person'};p.plot.scenes.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=scenes&id=scene'};let prompt;const out=await generateShotStoryboard({project:p,shotId:'S01',request:async ({ skill: s, user: v }) =>{if(s==='review')return reviewPass;prompt=v;return storyboardFixture(v)}});const item=out[0];assert.equal(item.video,'reference');assert.deepEqual(item.referenceSnapshot.map(r=>r.url),['/plugins/meiji/asset-file?category=characters&id=person','/plugins/meiji/asset-file?category=scenes&id=scene']);assert.equal(prompt,undefined);assert.match(item.prompt.text,/<Picture 2>/);assert.doesNotMatch(item.prompt.text,/asset-file|base64/);p.plot.characters.items[0].image.content.localPath='/new';assert.equal(item.referenceSnapshot[0].url,'/plugins/meiji/asset-file?category=characters&id=person')})
test('no picture means text mode; a confirmed local picture means reference mode',async()=>{const p=episodeFixture();assert.equal((await generateShotStoryboard({project:p,shotId:'S01',request:ask('text')}))[0].video,'text');p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=person'};assert.equal((await generateShotStoryboard({project:p,shotId:'S01',request:ask('<Picture 1>')}))[0].video,'reference')})
test('correction uses original text and opinions and reviews the changed version',async()=>{const p=episodeFixture();p.shots.items[0].seconds.review.text='不要转身';const prompts=[];const next={...p,...clearShotDownstream(p,'seconds','S01')};await checkContext.run({originalProject:p,review:'不要转身'},()=>generateShotSeconds({project:next,shotId:'S01',request:async ({ skill: s, user: v }) =>{prompts.push(v);return s==='review'?reviewPass:secondsResponse([['S01',5,'新的动作']])}}));assert.match(prompts[0],/修改基稿/);assert.match(prompts[0],/不要转身/);assert.match(prompts[1],/新的动作/)})
test('entity markers are matched to current model images',async()=>{const p=episodeFixture();p.shots.items[0].cast=[];p.shots.items[0].scene='';p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=person'};p.plot.scenes.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=scenes&id=scene'};const out=await generateShotStoryboard({project:p,shotId:'S01',request:ask('提示词')});assert.equal(out[0].referenceSnapshot.length,2)})
test('explicit shot cast excludes names mentioned only as background',async()=>{
 const p=episodeFixture();p.shots.items[0].cast=['旅人'];p.shots.items[0].content+='；另一个人只在回忆中提及'
 p.plot.characters.items.push({...p.plot.characters.items[0],id:'C02',name:'另一个人',image:{content:{localPath:'/plugins/meiji/asset-file?category=characters&id=other'}}})
 p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=main'}
 const rows=await generateShotStoryboard({project:p,shotId:'S01',request:ask('正文')})
 assert.deepEqual(rows[0].characters,['旅人']);assert.equal(rows[0].referenceSnapshot.length,1)
})


test('local duration failure joins review and automatic revision even when AI returns PASS', async () => {
 const project=episodeFixture();project.durationSeconds=30
 const calls=[]
 const replies=['## S01 / 5s\n过短片段',reviewPass,'## S01 / 15s\n第一段\n\n## S02 / 15s\n第二段',reviewPass]
 const saved=[]
 const out=await generateShots({project,request:async message=>{calls.push(message);return replies.shift()},persist:shots=>saved.push(shots)})
 assert.equal(calls.length,4)
 assert.match(calls[2].user,/镜头总时长 5s/)
 assert.equal(out.check.passed,true)
 assert.ok(saved.some(shots=>shots.check.passed===false))
})


test('review preserves the issue evidence verbatim without stripping text',async()=>{
 const out=await generateShots({project:episodeFixture(),request:ask(table,reviewFail('S01：实际冲突\n\n整体建议（非失败项）：\n增强视觉冲击力'))})
 assert.deepEqual(out.check.failures,['位置：本次内容；原因：S01：实际冲突\n\n整体建议（非失败项）：\n增强视觉冲击力；修正要求：修正上述问题'])
})
