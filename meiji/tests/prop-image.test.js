import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { cardModel, pictureOf } from '../shared/drama-model.js'
import { submitAssetImage } from '../server/flow/steps/shared/image-files.js'
import { runOperation, latestTask } from './fixtures/operation.js'
import { recordStore } from '../server/data/task-store.js'

test('道具生成候选、人工确认入库、原图修改使用同一 P ID', async t => {
 const e=await setupModel(t), store=scopeProjects(e.store,e.episodeId)
 await store.save(e.id,p=>({plot:{...p.plot,props:{...p.plot.props,items:[cardModel({id:'P01',type:'prop',name:'长衣',category:'clothing',description:'灰色长衣',evidence:'旅人身穿灰色长衣',ownerId:'C01'})]}}}))
 let editing=false
 const deps={home:e.home,waitForBackground:true,submitAssetImage:args=>submitAssetImage({...args,backend:{baseUrl:'https://gateway.test/v1',apiKey:'test-only',model:'elysium-image'},fetchImpl:async(url,options)=>{
  if(options.method==='GET')return new Response(Buffer.from('prop-image'))
  const body=typeof options.body==='string'?JSON.parse(options.body):null
  const prompt=body?.prompt || options.body.get('prompt')
  assert.match(prompt,/灰色长衣/)
  assert.match(prompt,/道具素材设计师/)
  assert.equal(url.pathname,editing?'/v1/images/edits':'/v1/images/generations')
  if(editing)assert.equal(options.body.get('image[]'),`data:image/png;base64,${Buffer.from('prop-image').toString('base64')}`)
  return Response.json({data:[{url:'/v1/media/prop'}]})
 }})}
 await runOperation(e.op('prop-image', {itemId:'P01'}),{...deps,operationId:'prop-generate'})
 let p=await e.read()
 assert.equal((await latestTask(recordStore(e.home,e.id),'image:P01')).status,'completed')
 assert.ok(!pictureOf(p.plot.props.items[0]).assetId)
 const [draft]=Object.values(p.pendingImages);assert.equal(draft.itemId,'P01');assert.equal(draft.key,'props')
 await runOperation(e.op('confirm-image',{draftId:draft.draftId}),{home:e.home,imageReviewAllowed:true})
 p=await e.read();assert.equal(pictureOf(p.plot.props.items[0]).assetCategory,'props');assert.ok(pictureOf(p.plot.props.items[0]).assetId)
 editing=true
 await runOperation(e.op('prop-image', {itemId:'P01',generationMode:'modify',review:'移除背景阴影'}),{...deps,operationId:'prop-modify'})
 assert.equal((await latestTask(recordStore(e.home,e.id),'image:P01')).status,'completed')
 assert.equal(Object.keys((await e.read()).pendingImages).length,1)
})
