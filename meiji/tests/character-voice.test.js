import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { storyPackageFixture } from './fixtures/story-package.js'
import { normalizeCharacters } from '../shared/story-content.js'
import { mergeLibraryGroup, editLinkedCard } from '../shared/library-rules.js'
import { imageItems } from '../shared/library-images.js'
import { characterFieldValues, characterFactText } from '../shared/character-facts.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { storyboardReady } from '../server/flow/steps/shared/film-freshness.js'
import { filmSubmit } from '../server/flow/steps/shared/video-submit.js'
import { renderCharacterDetail } from '../client/character-views.js'
import { runOperation } from './fixtures/operation.js'
import { setContent } from '../shared/drama-model.js'

const voice='成年女声，中音，清亮，普通话，吐字清晰'
const voiceCard=()=>({name:'电话顾客',presence:'voice',identity:'只通过电话发声的顾客',voiceDescription:voice})
function voicedProject(){
 const p=episodeFixture(),c=p.shots.items[0].seconds.content
 c.version=2;c.participants=[{name:'旅人',presence:'visible'},{name:'电话顾客',presence:'voice'}]
 for(const b of c.beats)for(const key of ['action','camera','space','sound','endState'])b[key]=b[key].replace(/【([^|]+)\|[^】]+】/g,'$1')
 const card=p.plot.characters.items[0];card.voiceDescription='成年男声，中低音，普通话';card.image.content={assetId:'person',localPath:'/person.png'}
 p.plot.characters.items.push(normalizeCharacters({items:[voiceCard()]}).items[0]);p.plot.characters.items[1].id='C02'
 c.dialogues=[{id:'D01',speakerName:'旅人',delivery:'on',text:'你好。',language:'zh-CN',startMs:0,endMs:1000,performance:'轻声，开口'}, {id:'D02',speakerName:'电话顾客',delivery:'off',text:'我到了。',language:'zh-CN',startMs:1000,endMs:2000,performance:'急促，不对口型'}];c.beats[0].dialogueIds=['D01','D02']
 return p
}

test('新人物声线校验、仅声音无外貌、空/额外人物不能绕过参与清单，旧卡兼容',()=>{
 const old=storyPackageFixture().characters;delete old.items[0].voiceDescription
 assert.doesNotThrow(()=>normalizeCharacters(old))
 assert.throws(()=>normalizeCharacters(old,{requireVoice:true}),/声音特征/)
 const card=normalizeCharacters({items:[voiceCard()]},{requireVoice:true}).items[0]
 assert.equal(card.look,'');assert.equal(card.voiceDescription,voice)
 assert.throws(()=>normalizeCharacters({items:[]},{allowEmpty:true,participants:[{name:'电话顾客',presence:'voice'}]}),/遗漏/)
 assert.throws(()=>normalizeCharacters({items:[voiceCard()]},{participants:[]}),/匹配/)
})

test('混合参与角色只有可见人物入图片清单，两位声音独立编号且当句表演和台词保留',()=>{
 const p=voicedProject(),s=p.shots.items[0],before=structuredClone(s.seconds.content),out=compileVideoPrompt(p,s)
 assert.deepEqual(imageItems(p,p).filter(item=>item.kind==='characters').map(item=>item.card.name),['旅人'])
 assert.deepEqual(out.referenceSnapshot.map(ref=>ref.entityId),['C01'])
 assert.match(out.prompt.text,/旅人 \(S1\)，固定声音特征：成年男声/)
 assert.match(out.prompt.text,/电话顾客 \(S2\)，固定声音特征：成年女声/)
 assert.match(out.prompt.text,/画外，急促，不对口型：<d>zh-CN: 我到了。<\/d>/)
 assert.deepEqual(s.seconds.content,before)
 assert.doesNotMatch(characterFactText(p.plot.characters.items[0]),/男声|普通话/)
})

test('声音资料快照变化阻止过期分镜通过和视频提交',()=>{
 const p=voicedProject(),s=p.shots.items[0],out=compileVideoPrompt(p,s)
 setContent(s.storyboard,out,{passed:true,failures:[]})
 assert.equal(storyboardReady(p,s.id),true)
 assert.doesNotThrow(()=>filmSubmit(p,{id:s.id,...out},{}))
 p.plot.characters.items[1].voiceDescription='低沉女声，缓慢语速'
 assert.equal(storyboardReady(p,s.id),false)
 assert.throws(()=>filmSubmit(p,{id:s.id,...out},{}),/人物声音/)
 assert.equal(compileVideoPrompt(p,s).referenceSnapshot[0].assetId,'person')
})

test('人物声线通过库编辑同步两集，仅清理依赖分镜，指令与图片保留',async t=>{
 const e=await setupModel(t)
 await e.store.save(e.id,root=>{
  const first=root.episodes[0],p={...first,library:root.library},group=normalizeCharacters(storyPackageFixture().characters),patch=mergeLibraryGroup(p,'characters',group)
  root.library=patch.library;first.plot=patch.plot
  const other=structuredClone(first);other.id='second-episode';root.episodes.push(other)
  for(const episode of root.episodes){episode.plot.characters.items[0].image.content={assetId:'person',localPath:'/person.png'};for(const shot of episode.shots.items)setContent(shot.storyboard,compileVideoPrompt(episode,shot),{passed:true,failures:[]})}
  return root
 })
 const before=await e.store.read(e.id)
 await e.store.save(e.id,root=>{const first=root.episodes[0],patch=editLinkedCard({...first,library:root.library},'characters',first.plot.characters.items[0].id,{voiceDescription:'男声，低音，沙哑，慢语速'});root.library=patch.library;first.plot=patch.plot;return root})
 const after=await e.store.read(e.id)
 for(const [i,episode] of after.episodes.entries()){
  assert.equal(episode.plot.characters.items[0].voiceDescription,'男声，低音，沙哑，慢语速')
  assert.deepEqual(episode.plot.characters.items[0].image.content,before.episodes[i].plot.characters.items[0].image.content)
  for(const [j,shot] of episode.shots.items.entries()){assert.equal(shot.storyboard.content,null);assert.deepEqual(shot.seconds.content,before.episodes[i].shots.items[j].seconds.content)}
 }
})

test('仅声音人物详情可编辑声线且不显示图片控件',t=>{
 const dom=new JSDOM('<body></body>'),prior=globalThis.document;globalThis.document=dom.window.document;t.after(()=>{globalThis.document=prior;dom.window.close()})
 const p=episodeFixture();p.plot.characters.items=normalizeCharacters({items:[voiceCard()]}).items
 const page=renderCharacterDetail(p,'C01',{perform:async()=>{}},{})
 assert.equal(page.querySelector('[aria-label="声音特征"]').value,voice)
 assert.equal(page.querySelector('[aria-label="面相"]'),null)
 assert.equal(page.querySelector('[aria-label="AI生成"]'),null)
 assert.equal(page.querySelector('input[type="file"]')?.hidden,true)
})

test('人工人物编辑保存声音并保持生图描述，拒绝过期声音稿',async t=>{
 const e=await setupModel(t),p=await e.read(),card=p.plot.characters.items[0],original=characterFieldValues(card),fields={...original,voiceDescription:'男声，中低音，略沙哑'}
 await runOperation(e.op('character-text',{itemId:card.id,original,fields}),{home:e.home,reviewContent:async()=>({passed:true,failures:[]})})
 const after=await e.read();assert.equal(after.plot.characters.items[0].voiceDescription,fields.voiceDescription);assert.equal(after.plot.characters.items[0].look,card.look)
 await assert.rejects(runOperation(e.op('character-text',{itemId:card.id,original,fields}),{home:e.home}),/已更新/)
})
