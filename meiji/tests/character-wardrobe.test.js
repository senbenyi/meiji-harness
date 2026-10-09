import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { setupModel } from './fixtures/model.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { characterImagePrompt } from '../server/prompts/interfaces/character-image-interface.js'
import { characterWardrobePrompts } from '../server/prompts/character-wardrobe-prompts.js'
import { submitAssetImage } from '../server/flow/steps/shared/image-files.js'
import { applyImageDraft, pictureTargetSnapshot, readImageDraft } from '../server/data/image-storage.js'
import { mergeLibraryGroup } from '../shared/library-rules.js'
import { characterImagesReady } from '../shared/character-costumes.js'
import { planRun } from '../shared/run-planner.js'
import { runOperation } from './fixtures/operation.js'
const costumes=[{id:'daily',name:'日常',description:'蓝色短衣配黑鞋',context:'日间'},{id:'night',name:'夜行',description:'黑色长袍配布靴',context:'夜间'}]
const backend={baseUrl:'https://gateway.test/v1',apiKey:'test-key',model:'elysium-image'}
async function fixture(t) {
 const e=await setupModel(t),store=scopeProjects(e.store,e.episodeId)
 await store.save(e.id,p=>{p.plot.characters.items[0].costumes=structuredClone(costumes);return {plot:p.plot}})
 const p=await e.read(), merged=mergeLibraryGroup(p,'characters',p.plot.characters)
 await store.save(e.id,merged)
 await e.store.save(e.id,p=>{const other=structuredClone(p.episodes[0]);other.id=crypto.randomUUID();p.episodes.push(other);return p})
 const project=await e.read(),item=project.plot.characters.items[0]
 return {...e,scoped:store,project,item}
}
async function generate(e,{fail=false}={}) {
 const calls=[];let ordinal=0
 const result=await submitAssetImage({assets:e.project.plot.characters,itemId:'C01',home:e.home,projectId:e.id,episodeId:e.episodeId,directory:join(e.home,'images'),backend,aspectRatio:'768x1344',
 prompt:characterImagePrompt(e.item,e.project),
 costumePrompts:characterWardrobePrompts(e.item,e.project,{canvas:{width:768,height:1344}}),
 fetchImpl:async(url,options)=>{
  if(options.method==='GET')return new Response(Buffer.from(`image-${ordinal}`))
  ordinal++;if(fail && ordinal===3)throw new Error('第二套生图失败')
  const body=typeof options.body==='string'?JSON.parse(options.body):Object.fromEntries(options.body)
  calls.push(body);return Response.json({data:[{url:`https://gateway.test/v1/media/image_${ordinal}`} ]})
 }})
 return {calls,draft:result.items[0].pendingImage}
}
test('独立生成人物基准图、各套穿搭统一参考基准图，确认后同步全部关联集且不覆盖服装数组',async t=>{
 const e=await fixture(t),{calls,draft}=await generate(e)
 assert.equal(calls.length,3);assert.match(calls[1].prompt,/蓝色短衣/);assert.doesNotMatch(calls[1].prompt,/黑色长袍/)
 assert.match(calls[2].prompt,/黑色长袍/);assert.doesNotMatch(calls[2].prompt,/蓝色短衣/)
 assert.equal(calls[1]['image[]'].type,'image/png')
 assert.deepEqual(Buffer.from(await calls[1]['image[]'].arrayBuffer()),Buffer.from('image-1'))
 assert.deepEqual(Buffer.from(await calls[1]['image[]'].arrayBuffer()),Buffer.from(await calls[2]['image[]'].arrayBuffer()))
 assert.notEqual(draft.draftId,draft.costumes.daily.draftId)
 assert.deepEqual(Object.keys(draft.costumes),['daily','night'])
 await applyImageDraft(e.home,e.scoped,e.project,{...draft,key:'characters',itemId:'C01',target:pictureTargetSnapshot(e.item)})
 const root=await e.store.read(e.id)
 for(const episode of root.episodes){const card=episode.plot.characters.items[0];assert.deepEqual(card.costumes,costumes);assert.equal(characterImagesReady(card.costumes,card.image.content),true);assert.notEqual(card.image.content.costumes.daily.assetId,card.image.content.costumes.night.assetId)}
 assert.deepEqual(root.library.characters[0].variants[0].image.content,root.episodes[0].plot.characters.items[0].image.content)
 for(const row of Object.values(draft.costumes))await assert.rejects(readImageDraft(e.home,row.draftId),{code:'ENOENT'})
})
test('第二套失败清理第一套候选，保留已有项目图片',async t=>{
 const e=await fixture(t),before=await e.read()
 await assert.rejects(generate(e,{fail:true}),/第二套生图失败/)
 assert.deepEqual(await readdir(join(e.home,'storages/meiji/image-drafts')),[])
 assert.deepEqual((await e.read()).plot.characters.items[0].image,before.plot.characters.items[0].image)
})
test('服装图缺失或描述改变时，生成模式不能因主图已有而跳过',async t=>{
 const e=await fixture(t),root=await e.store.read(e.id),entry=root.library.characters[0],variant=entry.variants[0]
 variant.image.content={localPath:'/main.png'}
 const planned=()=>planRun(root,{to:'images',mode:'generate',scope:{library:{kind:'characters',id:entry.id,variantId:variant.id}}})
 assert.notEqual(planned().steps.find(s=>s.kind==='image').status,'skipped')
 variant.image.content.costumes=Object.fromEntries(costumes.map(c=>[c.id,{localPath:`/${c.id}.png`,description:c.description}]))
 assert.equal(planned().steps.find(s=>s.kind==='image').status,'skipped')
 variant.fields.costumes[0].description='红色长衣'
 assert.notEqual(planned().steps.find(s=>s.kind==='image').status,'skipped')
})
test('库资料更新重建生图描述并同步全部剧集，不保留旧look',async t=>{
 const e=await fixture(t),root=await e.store.read(e.id),entry=root.library.characters[0]
 await runOperation({projectId:e.id,action:'entry-edit',libraryKind:'characters',libraryId:entry.id,variantId:entry.defaultVariantId,fields:{age:'四十岁',height:'一米九',features:'长脸',costumes:[...costumes,{id:'ceremony',name:'礼服',description:'白色礼服',context:'典礼'}]}},{home:e.home})
 const after=await e.store.read(e.id)
 for(const episode of after.episodes){const c=episode.plot.characters.items[0];assert.equal(c.age,'四十岁');assert.match(c.look,/四十岁/);assert.match(c.look,/一米九/);assert.equal(c.costumes.length,3)}
})

test('真实人物任务保存整套候选，确认后服装图片入库',async t=>{
 const e=await fixture(t);let posts=0
 await runOperation(e.op('image',{itemId:'C01',generationMode:'regenerate'}),{home:e.home,fetchImpl:async(url,options)=>{
  if(options.method==='GET')return new Response(Buffer.from('wardrobe-image'))
  posts++;return Response.json({data:[{url:`${url.origin}/v1/media/image_${posts}`} ]})
 }})
 assert.equal(posts,3)
 const p=await e.read(),draft=Object.values(p.pendingImages)[0]
 assert.deepEqual(Object.keys(draft.costumes),['daily','night'])
 await runOperation(e.op('confirm-image',{draftId:draft.draftId}),{home:e.home,imageReviewAllowed:true})
 assert.equal(characterImagesReady(costumes,(await e.read()).plot.characters.items[0].image.content),true)
})

test('真实项目库任务生成整套候选，确认后同步关联集',async t=>{
 const e=await fixture(t),root=await e.store.read(e.id),entry=root.library.characters[0];let posts=0
 await runOperation({projectId:e.id,action:'library-image',libraryKind:'characters',libraryId:entry.id,variantId:entry.defaultVariantId,generationMode:'regenerate'},{home:e.home,fetchImpl:async(url,options)=>{
  if(options.method==='GET')return new Response(Buffer.from('wardrobe-library-image'))
  posts++;return Response.json({data:[{url:`${url.origin}/v1/media/image_${posts}`} ]})
 }})
 assert.equal(posts,3)
 const draft=Object.values((await e.store.read(e.id)).pendingImages)[0]
 await runOperation({projectId:e.id,action:'entry-image-confirm',libraryKind:'characters',libraryId:entry.id,variantId:entry.defaultVariantId,draftId:draft.draftId},{home:e.home})
 for(const episode of (await e.store.read(e.id)).episodes)assert.equal(characterImagesReady(costumes,episode.plot.characters.items[0].image.content),true)
})

test('整套候选发布失败时清理新素材，保留候选供重试',async t=>{
 const e=await fixture(t),{draft}=await generate(e)
 const {assetStore}=await import('../server/data/asset-library-store.js')
 await assert.rejects(applyImageDraft(e.home,{save:async()=>{throw Error('保存失败')}},e.project,{...draft,key:'characters',itemId:'C01',target:pictureTargetSnapshot(e.item)}),/保存失败/)
 assert.deepEqual(await assetStore(e.home).list('characters'),[])
 for(const row of Object.values(draft.costumes))assert.ok(await readImageDraft(e.home,row.draftId))
})


test('单套服装导入、素材库选图及删除同步关联集，保留主图和其他服装',async t=>{
 const e=await fixture(t),root=await e.store.read(e.id),entry=root.library.characters[0],variant=entry.variants[0]
 const main={localPath:'/main.png'},night={localPath:'/night.png',description:costumes[1].description}
 await e.store.save(e.id,p=>{p.library.characters[0].variants[0].image.content={...main,costumes:{night}};return p})
 const scope={libraryKind:'characters',libraryId:entry.id,variantId:variant.id}
 const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII='
 await runOperation(e.op('entry-image',{...scope,costumeId:'daily',data}),{home:e.home})
 let after=await e.store.read(e.id),image=after.library.characters[0].variants[0].image.content
 assert.ok(image.costumes.daily.assetId);assert.equal(image.localPath,main.localPath);assert.deepEqual(image.costumes.night,night)
 const assetId=image.costumes.daily.assetId
 for(const episode of after.episodes)assert.equal(episode.plot.characters.items[0].image.content.costumes.daily.assetId,assetId)
 await runOperation(e.op('entry-image',{...scope,costumeId:'night',assetId,category:'characters'}),{home:e.home})
 after=await e.store.read(e.id);assert.equal(after.library.characters[0].variants[0].image.content.costumes.night.assetId,assetId)
 await runOperation(e.op('entry-image-clear',{...scope,costumeId:'daily'}),{home:e.home})
 after=await e.store.read(e.id);image=after.library.characters[0].variants[0].image.content
 assert.equal(image.costumes.daily,undefined);assert.equal(image.localPath,main.localPath);assert.equal(image.costumes.night.assetId,assetId)
 for(const episode of after.episodes)assert.deepEqual(episode.plot.characters.items[0].image.content,image)
 await assert.rejects(runOperation(e.op('entry-image-clear',{...scope,costumeId:'missing'}),{home:e.home}),/服装不存在/)
 assert.deepEqual(await e.store.read(e.id),after)
})


test('移除服装同时清理对应图片引用和默认着装，其他服装主图及关联集保留',async t=>{
 const e=await fixture(t),root=await e.store.read(e.id),entry=root.library.characters[0],variant=entry.variants[0]
 await e.store.save(e.id,p=>{const v=p.library.characters[0].variants[0];v.fields.costume=costumes[0].description;v.image.content={localPath:'/main.png',costumes:{daily:{localPath:'/daily.png',description:costumes[0].description},night:{localPath:'/night.png',description:costumes[1].description}}};return p})
 await runOperation(e.op('entry-edit',{libraryKind:'characters',libraryId:entry.id,variantId:variant.id,fields:{costumes:[costumes[1]]}}),{home:e.home})
 const after=await e.store.read(e.id),v=after.library.characters[0].variants[0]
 assert.deepEqual(v.fields.costumes,[costumes[1]]);assert.equal(v.fields.costume,costumes[1].description)
 assert.equal(v.image.content.localPath,'/main.png');assert.equal(v.image.content.costumes.daily,undefined);assert.equal(v.image.content.costumes.night.localPath,'/night.png')
 for(const episode of after.episodes){assert.deepEqual(episode.plot.characters.items[0].costumes,[costumes[1]]);assert.deepEqual(episode.plot.characters.items[0].image.content,v.image.content)}
})
