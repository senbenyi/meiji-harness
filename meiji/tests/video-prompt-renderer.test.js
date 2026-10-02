import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { parseSecondsResponse, validateSeconds, secondsText } from '../shared/seconds-content.js'
import { h3PromptFailures } from '../server/generate/film.js'
import { generateShotStoryboard } from '../server/generate/shot-text.js'
import { cardModel } from '../shared/drama-model.js'

test('unpictured entities compile to text with no model call or invented picture', async () => {
 const p=episodeFixture(), item=(await generateShotStoryboard({project:p,shotId:'S01',request:()=>assert.fail('no model request')})).find(i=>i.id==='S01')
 assert.equal(item.video,'text'); assert.deepEqual(item.referenceSnapshot,[])
 assert.match(item.prompt.text,/旅人朝北行走/);assert.doesNotMatch(item.prompt.text,/【|<Subject|<Picture/)
 assert.deepEqual(h3PromptFailures(item.prompt.text,[],'text'),[])
})
test('clothing shares wearer Subject, weapon stays an entity, picture list follows definitions',()=>{
 const p=episodeFixture();p.plot.characters.items[0].image.content={assetId:'person',assetCategory:'characters',localPath:'/person.png'}
 p.plot.props.items=[cardModel({id:'P01',type:'prop',name:'长衣',category:'clothing',ownerId:'C01',description:'深色长衣',localPath:'/clothes.png'}),cardModel({id:'P02',type:'prop',name:'剑',category:'weapon',ownerId:'C01',description:'长剑'})]
 const s=p.shots.items[0];s.seconds.content.beats[0].action='【旅人|C01】穿【长衣|P01】，右手握【剑|P02】朝北行走'
 const out=compileVideoPrompt(p,s)
 assert.equal(out.video,'reference');assert.equal(out.referenceSnapshot.length,2)
 assert.match(out.prompt.text,/<Subject 1>：旅人；<Picture 1>.*<Picture 2>/)
 assert.match(out.prompt.text,/<Subject 2>：剑；无参考图/)
 assert.deepEqual(h3PromptFailures(out.prompt.text,out.referenceSnapshot,'reference'),[])
})
test('dialogue events render once, continuous beats do not create cuts, music is not invented',()=>{
 const p=episodeFixture(),s=p.shots.items[0],c=s.seconds.content
 c.beats[0].durationMs=2000;c.beats.push({...c.beats[0],id:'B02',durationMs:3000})
 c.dialogues=[{id:'D01',speakerId:'C01',text:'我到了。',language:'zh-CN',startMs:1000,endMs:2500,delivery:'on',performance:'平静，开口'}]
 c.beats[0].dialogueIds=['D01']
 const out=compileVideoPrompt(p,s)
 assert.equal(out.prompt.text.split('我到了。').length-1,1)
 assert.doesNotMatch(out.prompt.text,/\[Shot 2\]/);assert.match(out.prompt.text,/non_diegetic_music:\nN\/A/)
 assert.match(secondsText(c),/0–2s/)
 c.beats[1].dialogueIds=['D01'];assert.throws(()=>validateSeconds(c,s,p),/只能引用一次/)
})
test('wrong ID, renamed label, duration and extra/missing shots are rejected',()=>{
 const p=episodeFixture(),s=p.shots.items[0],c=s.seconds.content
 c.beats[0].action='【陌生人|C99】走';assert.throws(()=>validateSeconds(c,s,p),/未知实体/)
 c.beats[0].action='【陌生人|C01】走';assert.throws(()=>validateSeconds(c,s,p),/名称不匹配/)
 c.beats[0].action='【旅人|C01】走';c.beats[0].durationMs=4000;assert.throws(()=>validateSeconds(c,s,p),/总时长/)
 assert.throws(()=>parseSecondsResponse(JSON.stringify({shots:[c]}),p.shots.items,p),/镜头清单不符/)
})

test('compiled Picture order is the exact local base64 order and changed images reject submission',async t=>{
 const {tempHome}=await import('./fixtures/model.js')
 const {savePicture,referenceImageData}=await import('../server/data/pictures.js')
 const {filmSubmit}=await import('../server/flow/operations/films.js')
 const home=await tempHome(t),p=episodeFixture(),s=p.shots.items[0]
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
 const second=Buffer.concat([png,Buffer.from('second')])
 p.plot.characters.items[0].image.content=await savePicture(home,png,'image/png','characters','旅人')
 p.plot.scenes.items[0].image.content=await savePicture(home,second,'image/png','scenes','庭院')
 const item={id:s.id,...compileVideoPrompt(p,s)}
 const payload=filmSubmit(p,item,{})
 assert.deepEqual(payload.referenceImages,item.referenceSnapshot.map(i=>i.url))
 assert.deepEqual(await referenceImageData(home,p,item.referenceSnapshot),[png,second].map(b=>'data:image/png;base64,'+b.toString('base64')))
 assert.match(item.prompt.text,/<Subject 1>：旅人；<Picture 1>/)
 assert.match(item.prompt.text,/<Subject 2>：庭院；<Picture 2>/)
 p.plot.characters.items[0].image.content=p.plot.scenes.items[0].image.content
 assert.throws(()=>filmSubmit(p,item,{}),/参考素材已变化/)
})
