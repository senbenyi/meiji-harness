import test from 'node:test'
import assert from 'node:assert/strict'
import {episodeFixture,setupModel} from './fixtures/model.js'
import {storyPackageFixture,storyRequest} from './fixtures/story-package.js'
import {parseCharacters} from '../server/flow/steps/step-extract-characters.js'
import {checkCharacters} from '../server/flow/steps/step-review-characters.js'
import {createLibraryEntry,applyLibraryCard} from '../shared/library-rules.js'
import {deleteEpisodeProjectCharacter} from '../shared/character-deletion.js'
import {operationDeletes} from '../shared/operation-cascade.js'
import {operations} from '../server/flow/operations/direct/operation-character-delete.js'
import {runOperation} from './fixtures/operation.js'
import {buildStoryPrompts} from '../server/prompts/story-prompts.js'
import {checkContext} from '../server/runtime/operation-context.js'
import {savePicture} from '../server/data/image-storage.js'

function libraryProject() {
  const p=episodeFixture();p.library={characters:[],scenes:[],props:[]}
  const original=storyPackageFixture().characters.items[0]
  const {entry,variant}=createLibraryEntry(p,'characters',{...original,name:'餐馆老板',aliases:['旅人'],image:{content:{assetId:'existing',assetCategory:'characters',localPath:'/existing.png'}}})
  return {p,entry,variant}
}

test('简短ID、名称及别名引用优先使用库资料，忽略模型重写且保留剧情称谓',()=>{
  const {p,entry,variant}=libraryProject(),before=structuredClone(p)
  for(const raw of [{name:'旅人',presence:'visible',libraryId:entry.id},{name:'旅人',presence:'visible'},{name:entry.name,presence:'voice',look:'模型伪造',voiceDescription:'不同声线'}]){
    const text=JSON.stringify({items:[raw]}),group=parseCharacters(text,p),card=group.items[0]
    assert.equal(card.name,entry.name);assert.equal(card.presence,raw.presence)
    assert.equal(card.look,variant.fields.look);assert.equal(card.voiceDescription,variant.fields.voiceDescription)
    assert.equal(card.ref.libraryId,entry.id);assert.equal(card.image.content.assetId,'existing')
    if(raw.name==='旅人')assert.equal(card.sourceName,'旅人')
    assert.deepEqual(checkCharacters(text,p),[])
  }
  assert.deepEqual(p,before)
})

test('无效关联、歧义和同身份重复引用拒绝，新角色仍须完整资料',()=>{
  const {p,entry}=libraryProject(),parse=items=>parseCharacters(JSON.stringify({items}),p)
  assert.throws(()=>parse([{name:'旅人',libraryId:'missing'}]),/库条目不存在/)
  assert.throws(()=>parse([{name:'旅人'},{name:entry.name,libraryId:entry.id}]),/重复引用/)
  assert.throws(()=>parse([{name:'新人物'}]),/声音特征/)
  assert.throws(()=>parse([{name:'新人物',voiceDescription:'低音'}]),/画面提示词/)
  const newPerson={...storyPackageFixture().characters.items[0],name:'新人物'}
  assert.equal(parse([newPerson]).items[0].ref,undefined)
  p.library.characters.push({...structuredClone(entry),id:'R02'})
  assert.throws(()=>parse([{name:'旅人'}]),/匹配多个/)
})

test('剧集无关联旧卡按别名删除项目及其他集关联，无匹配只删本集',()=>{
  const {p,entry,variant}=libraryProject(),other=episodeFixture()
  for (const episode of [p,other]) for (const shot of episode.shots.items) {
    shot.seconds.content.version=2;shot.seconds.content.participants=[{name:'旅人',presence:'visible'}]
    for (const beat of shot.seconds.content.beats) for (const field of ['action','camera','space','sound','endState']) beat[field]=beat[field].replace(/【([^|]+)\|[^】]+】/g,'$1')
  }
  other.plot.characters.items=[applyLibraryCard(other,'characters',other.plot.characters.items[0],{entry,variant})]
  const root={episodes:[p,other],library:p.library,pendingImages:{}},before=structuredClone(root)
  const preview=operationDeletes(root,{action:'character-delete',episodeId:p.id,itemId:'C01'})
  assert.ok(preview.some(d=>d.kind==='character-library'))
  assert.ok(preview.some(d=>d.episodeId===other.id&&d.kind==='character'))
  assert.deepEqual(root,before)
  const next=deleteEpisodeProjectCharacter(root,p.id,'C01').project
  assert.deepEqual(next.library.characters,[])
  assert.ok(next.episodes.every(e=>!e.plot.characters.items.length))
  assert.deepEqual(next.episodes.map(e=>e.shots.items.map(s=>s.seconds.content)),before.episodes.map(e=>e.shots.items.map(s=>s.seconds.content)))
  root.library.characters=[];other.plot.characters.items[0].ref=undefined
  const local=deleteEpisodeProjectCharacter(root,p.id,'C01').project
  assert.deepEqual(local.episodes[1],root.episodes[1])
})

test('同步删除持有项目锁，跨集人物/库图忙状态失败时整体不写入',async t=>{
  assert.equal(operations['character-delete'].lock,'project');assert.equal(operations['character-delete'].stage,'project')
  const e=await setupModel(t),{entry,variant}=libraryProject(),other=episodeFixture()
  other.plot.characters.items[0]=applyLibraryCard(other,'characters',other.plot.characters.items[0],{entry,variant})
  other.plot.characters.items[0].image.operation={id:'busy',phase:'generating'}
  await e.store.save(e.id,root=>({...root,library:{characters:[entry],scenes:[],props:[]},episodes:[root.episodes[0],other]}))
  const before=await e.store.read(e.id)
  await assert.rejects(runOperation({action:'character-delete',projectId:e.id,episodeId:e.episodeId,itemId:'C01'},{home:e.home}),/正在执行/)
  const after=await e.store.read(e.id);assert.deepEqual(after.library,before.library);assert.deepEqual(after.episodes,before.episodes)
  const root=structuredClone(before);root.episodes[1].plot.characters.items[0].image.operation=null;root.library.characters[0].variants[0].image.operation={phase:'generating'}
  assert.throws(()=>deleteEpisodeProjectCharacter(root,e.episodeId,'C01'),/库图片正在执行/)
})

test('真实人物提取保存简短别名引用，保持库身份声线和图片，只新建未登记角色',async t=>{
  const e=await setupModel(t),fixture=storyPackageFixture(),old=await savePicture(e.home,Buffer.from('original'),'image/png','characters','餐馆老板')
  await e.store.save(e.id,root=>{createLibraryEntry(root,'characters',{...fixture.characters.items[0],name:'餐馆老板',aliases:['旅人'],image:{content:old}});return root})
  const before=await e.store.read(e.id),entry=before.library.characters[0],requests=[]
  fixture.characters.items=[{name:'旅人',presence:'visible',libraryId:entry.id},{...fixture.characters.items[0],name:'同行人'}]
  await runOperation({action:'story',only:'characters',mode:'regenerate',projectId:e.id,episodeId:e.episodeId},{home:e.home,request:storyRequest(fixture,(_kind,m)=>{requests.push(m)})})
  const after=await e.store.read(e.id),view=await e.read(),card=view.plot.characters.items.find(c=>c.ref.libraryId===entry.id)
  assert.deepEqual(after.library.characters[0],entry);assert.equal(after.library.characters.length,2)
  assert.equal(card.name,'餐馆老板');assert.equal(card.sourceName,'旅人');assert.equal(card.image.content.assetId,old.assetId)
  assert.equal(card.voiceDescription,entry.variants[0].fields.voiceDescription)
  assert.ok(requests.some(m=>m.skill==='review'));assert.ok(requests.every(m=>m.user.includes('查看项目库目录')))
})

test('生成、修改与审核提示词明确先查项目目录及已有角色简短引用分支',()=>{
  const {p}=libraryProject()
  for(const mode of ['regenerate','modify'])checkContext.run({generationMode:mode,originalProject:p},()=>{
    const prompts=buildStoryPrompts(p,'characters'),requests=[prompts.generation,prompts.review('{"items":[]}'),prompts.revision('{"items":[]}','核对人物')]
    for(const request of requests){assert.match(request.user,/查看项目库目录/);assert.match(request.system,/已有角色|已有项目角色/);assert.match(request.user,/R01/)}
    assert.match(prompts.generation.system,/已有角色仅返回 name/)
  })
})
