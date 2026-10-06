import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { projectStore, revisionStore } from '../server/data/project-store.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { blankEpisode } from '../shared/episode-rules.js'
import { runOperation } from './fixtures/operation.js'
import { cascade } from '../shared/pipeline-cascade.js'
import { savePicture, saveImageDraft, readImageDraft, pictureTargetSnapshot } from '../server/data/image-storage.js'
import { assetStore } from '../server/data/asset-library-store.js'
import { node, contentNode, pictureOf, begin, setContent } from '../shared/drama-model.js'
async function pending(t, kind='character') {
 const e=await setupModel(t),p=await e.read(),track=undefined,slot=kind==='part'?'clothes':undefined
 const target=track?{id:track,...p.shots.items[0].storyboard.content}:p.plot.characters.items[0]
 const reference=await saveImageDraft(e.home,Buffer.from('preview-image'),'image/png',track?'scenes':'characters','预览',{projectId:e.id,episodeId:e.episodeId})
 const draft={...reference,projectId:e.id,episodeId:e.episodeId,...(track?{track}:{key:'characters',itemId:'C01'}),...(slot?{slot}:{}),target:pictureTargetSnapshot(target),name:'预览'}
 await scopeProjects(e.store,e.episodeId).save(e.id,{pendingImages:{[reference.draftId]:draft}})
 return {...e,draft,operation:e.op('confirm-image',{draftId:draft.draftId}),deps:{home:e.home,imageReviewAllowed:true}}
}
test('parallel saves through separate stores preserve all independent changes',async t=>{const e=await setupModel(t);await Promise.all(Array.from({length:20},(_,i)=>projectStore(e.home).save(e.id,{['field'+i]:i})));const p=await e.store.read(e.id);for(let i=0;i<20;i++)assert.equal(p['field'+i],i);assert.equal(JSON.parse(await readFile(`${e.home}/storages/meiji/projects/${e.id}.json`,'utf8')).schemaVersion,3)})
test('stale model task cannot overwrite a changed dependency',async t=>{const e=await setupModel(t),job=revisionStore(e.store,'task',{episodeId:e.episodeId,track:'S01'});await job.read(e.id);await scopeProjects(e.store,e.episodeId).save(e.id,p=>({summary:contentNode(p.summary,'新剧情')}));await assert.rejects(job.save(e.id,{title:'旧结果'}),{status:409})})
test('picture update removes affected media and preserves seconds',()=>{const p=episodeFixture();p.shots.items[0].content='旅人【旅人|C01】';setContent(p.shots.items[0].video,{url:'/old',status:'ready'},{passed:true,failures:[]});const next=cascade(p,{type:'image',itemId:'C01'}).patch;assert.equal(next.shots.items[0].video.content,null);assert.equal(next.shots.items[0].storyboard.content,null);assert.deepEqual(next.shots.items[0].seconds,p.shots.items[0].seconds)})
test('same asset may be used by two episodes; detach never deletes shared file',async t=>{
 const e=await setupModel(t),ref=await savePicture(e.home,Buffer.from('picture'),'image/png','characters','旅人'),second=episodeFixture()
 await e.store.save(e.id,p=>({episodes:[...p.episodes,second]}))
 for(const episodeId of [e.episodeId,second.id])await runOperation(e.op('use-asset',{episodeId,itemId:'C01',category:'characters',assetId:ref.assetId}),{home:e.home})
 await runOperation(e.op('clear-image',{itemId:'C01'}),{home:e.home})
 const p=await e.store.read(e.id);assert.equal(p.episodes[0].plot.characters.items[0].image.content,null);assert.equal(p.episodes[1].plot.characters.items[0].image.content.assetId,ref.assetId);assert.ok((await assetStore(e.home).file('characters',ref.assetId)).path)
})
for(const kind of ['character'])test(`${kind} preview publishes to the local library without a gateway upload`,async t=>{
 const e=await pending(t,kind);assert.equal((await assetStore(e.home).list('characters')).length,0)
 await runOperation(e.operation,e.deps);const p=await e.read();const media=kind==='part'?p.plot.characters.items[0].clothes[0]:p.plot.characters.items[0].image.content
 assert.equal(Object.hasOwn(media,'imageUrl')||Object.hasOwn(media,'file'),false);assert.ok(media.assetId);assert.match(media.localPath||media.url,/asset-file/);assert.deepEqual(p.pendingImages,{});await assert.rejects(readImageDraft(e.home,e.draft.draftId),{code:'ENOENT'})
})
test('AI tool cannot approve an image; changed owner rejects preview',async t=>{const e=await pending(t);await assert.rejects(runOperation(e.operation,{home:e.home}),{status:403});await scopeProjects(e.store,e.episodeId).save(e.id,p=>{p.plot.characters.items[0].name='新身份';return {plot:p.plot}});await assert.rejects(runOperation(e.operation,e.deps),/对应内容已修改/)})
test('discard deletes only the draft',async t=>{const e=await pending(t);await runOperation({...e.operation,action:'discard-image'},e.deps);assert.deepEqual((await e.read()).pendingImages,{});assert.equal((await e.read()).plot.characters.items[0].name,'旅人')})
