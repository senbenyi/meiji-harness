import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { parseSecondsResponse, validateSeconds, secondsText } from '../shared/seconds-content.js'
import { h3PromptFailures } from '../shared/video-rules.js'
import { generateShotStoryboard } from '../server/flow/steps/step-generate-storyboard.js'
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
 const { tempHome } = await import('./fixtures/model.js')
 const { savePicture, referenceImageData } = await import('../server/data/image-storage.js')
 const { filmSubmit } = await import('../server/flow/steps/shared/video-submit.js')
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
test('「名字【名字|ID】」写法通过校验，渲染时名字不重复，未标记名字仍报错', () => {
 const p=episodeFixture(),s=p.shots.items[0],c=s.seconds.content
 c.beats[0].action='旅人【旅人|C01】沿庭院【庭院|E01】朝北行走'
 assert.doesNotThrow(()=>validateSeconds(c,s,p))
 const text=compileVideoPrompt(p,s).prompt.text
 assert.match(text,/旅人沿庭院朝北行走/); assert.doesNotMatch(text,/旅人旅人|庭院庭院|【/)
 p.plot.characters.items[0].image.content={assetId:'person',assetCategory:'characters',localPath:'/person.png'}
 assert.match(compileVideoPrompt(p,s).prompt.text,/<Subject 1>（旅人）沿<Subject 2>（庭院）朝北行走/)
 c.beats[0].action='旅人沿庭院【庭院|E01】朝北行走'
 assert.throws(()=>validateSeconds(c,s,p),/旅人须写为旅人【旅人\|C01】/)
})
test('未标记名字的报错只指出未标记的那一处，已标记的和长名字里的短名字不重复报', () => {
 const p=episodeFixture(),s=p.shots.items[0],c=s.seconds.content
 c.beats[0].action='旅人【旅人|C01】走进庭院【庭院|E01】，此处假设旅人背对镜头'
 assert.throws(()=>validateSeconds(c,s,p),error=>{
  assert.match(error.message,/片段「.*此处假设旅人背对镜头」中的旅人须写为旅人【旅人\|C01】/)
  assert.equal(error.message.split('；').length,1)
  return true
 })
})

for(const reference of [false,true])test(`独立旁白与人物声音分别编译，不新增身体或图片：${reference?'多模态':'文本'}`,()=>{
 const p=episodeFixture(),s=p.shots.items[0],c=s.seconds.content
 if(reference)p.plot.characters.items[0].image.content={assetId:'person',assetCategory:'characters',localPath:'/person.png'}
 c.dialogues=[
  {id:'D01',speakerId:'NARRATOR',text:'旧友的失约，一直让他难以释怀。',language:'zh-CN',startMs:0,endMs:3500,delivery:'off',performance:'平静画外声，画内人物不对口型'},
  {id:'D02',speakerId:'C01',text:'我到了。',language:'zh-CN',startMs:3500,endMs:5000,delivery:'on',performance:'平静，开口'},
 ]
 c.beats[0].dialogueIds=['D01','D02']
 assert.doesNotThrow(()=>validateSeconds(c,s,p))
 assert.match(secondsText(c),/旁白 D01（0–3.5s，NARRATOR，off/)
 const out=compileVideoPrompt(p,s)
 assert.match(out.prompt.text,/旁白 \(S1\)，独立画外旁白，不对口型/)
 assert.match(out.prompt.text,/旅人 \(S2\)，画内/)
 for(const d of c.dialogues)assert.equal(out.prompt.text.split(d.text).length-1,1)
 assert.deepEqual(out.characters,['旅人']);assert.deepEqual(out.entityIds,['C01','E01'])
 assert.equal(out.referenceSnapshot.length,reference?1:0)
 assert.doesNotMatch(out.prompt.text,/NARRATOR|<Subject \d+>：旁白|<Picture \d+>（旁白）/)
 assert.deepEqual(h3PromptFailures(out.prompt.text,out.referenceSnapshot,out.video),[])
})

test('纯旁白无需登记人物，环境镜不会虚构出镜身体',()=>{
 const p=episodeFixture(),s=p.shots.items[0],c=s.seconds.content
 p.plot.characters.items=[]
 c.summary='庭院空无一人';c.beats[0].action='庭院【庭院|E01】中风吹动草叶'
 c.beats[0].endState='庭院【庭院|E01】仍空无一人'
 c.dialogues=[{id:'D01',speakerId:'NARRATOR',text:'多年过去，这里仍没有回应。',language:'zh-CN',startMs:0,endMs:4000,delivery:'off',performance:'低沉画外声'}]
 c.beats[0].dialogueIds=['D01']
 const out=compileVideoPrompt(p,s)
 assert.deepEqual(out.characters,[]);assert.deepEqual(out.entityIds,['E01'])
 assert.equal(out.referenceSnapshot.length,0);assert.match(out.prompt.text,/独立画外旁白，不对口型/)
})

for(const [label,patch,error] of [
 ['画内旁白',{delivery:'on'},/对白身份/],
 ['内心旁白',{delivery:'inner'},/对白身份/],
 ['未知人物',{speakerId:'C99'},/对白身份/],
 ['未知旁白ID',{speakerId:'narrator'},/对白身份/],
 ['超出本镜时长',{endMs:5001},/对白时间越界/],
 ['缺少原文',{text:''},/对白身份/],
])test(`旁白支持不放宽原有校验：${label}`,()=>{
 const p=episodeFixture(),s=p.shots.items[0],c=s.seconds.content
 c.dialogues=[{id:'D01',speakerId:'NARRATOR',text:'多年过去，这里仍没有回应。',language:'zh-CN',startMs:0,endMs:4000,delivery:'off',performance:'平静画外声',...patch}]
 c.beats[0].dialogueIds=['D01']
 assert.throws(()=>validateSeconds(c,s,p),error)
})

for (const [open, close] of [['“','”'], ['‘','’'], ['"','"'], ["'","'"]]) for (const reference of [false, true]) test(`带引号角色引用 ${open}我${close}：${reference ? '图片' : '文本'}校验与编译`, () => {
 const p=episodeFixture(),s=p.shots.items[0]
 p.plot.characters.items[0].name='我'
 s.seconds.content=JSON.parse(JSON.stringify(s.seconds.content).replaceAll('旅人','我'))
 const c=s.seconds.content,mention=`${open}我${close}【我|C01】`
 for (const field of ['action','camera','space','sound','endState']) c.beats[0][field]=`${mention}站在门前`
 c.dialogues=[{id:'D01',speakerId:'C01',text:'“我”还在这里。',language:'zh-CN',startMs:0,endMs:3000,delivery:'inner',performance:'内心声，嘴部不动'}]
 c.beats[0].dialogueIds=['D01']
 if(reference)p.plot.characters.items[0].image.content={assetId:'person',assetCategory:'characters',localPath:'/person.png'}
 const before=structuredClone(c)
 assert.doesNotThrow(()=>validateSeconds(c,s,p))
 const out=compileVideoPrompt(p,s)
 assert.ok(out.prompt.text.includes(reference ? '<Subject 1>（我）站在门前' : '我站在门前'))
 assert.ok(!out.prompt.text.includes(`${open}我${close}${reference ? '<Subject' : '我'}`))
 assert.ok(out.prompt.text.includes(c.dialogues[0].text))
 assert.deepEqual(out.entityIds,['C01'])
 assert.deepEqual(c,before)
 c.beats[0].action+=`，${open}我${close}仍在等候`
 assert.throws(()=>validateSeconds(c,s,p),error=>{
  assert.equal(error.message.split('；').length,1)
  assert.match(error.message,/中的我须写为我【我\|C01】/)
  return true
 })
 c.beats[0].action=`${open}我${close}【我|C99】站在门前`
 assert.throws(()=>validateSeconds(c,s,p),/未知实体ID/)
 c.beats[0].action=`${open}我${close}【别人|C01】站在门前`
 assert.throws(()=>validateSeconds(c,s,p),/实体名称不匹配/)
})
