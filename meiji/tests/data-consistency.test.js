import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { projectStore, revisionStore } from '../server/data/projects.js'
import { scopeProjects, blankEpisode } from '../server/data/episodes.js'
import { runOperation } from '../server/flow/actions.js'
import { staleMedia } from '../shared/gates.js'
import { savePicture, saveImageDraft, readImageDraft, pictureTargetSnapshot } from '../server/data/pictures.js'
import { assetStore } from '../server/data/library.js'
import { node, contentNode, pictureOf, begin, setContent } from '../shared/drama-model.js'
async function pending(t, kind='character') {
 const e=await setupModel(t),p=await e.read(),track=kind==='pencil'?'S01':undefined,slot=kind==='part'?'clothes':undefined
 const target=track?{id:track,...p.shots.items[0].storyboard.content}:p.plot.characters.items[0]
 const reference=await saveImageDraft(e.home,Buffer.from('preview-image'),'image/png',track?'scenes':'characters','预览',{projectId:e.id,episodeId:e.episodeId})
 const draft={...reference,projectId:e.id,episodeId:e.episodeId,...(track?{track}:{key:'characters',itemId:'C01'}),...(slot?{slot}:{}),target:pictureTargetSnapshot(target),name:'预览'}
 await scopeProjects(e.store,e.episodeId).save(e.id,{pendingImages:{[reference.draftId]:draft}})
 return {...e,draft,operation:e.op('confirm-image',{draftId:draft.draftId}),deps:{home:e.home,imageReviewAllowed:true,uploadGatewayFile:async()=>({id:'remote',url:'https://example.test/confirmed.png'})}}
}
test('parallel saves through separate stores preserve all independent changes',async t=>{const e=await setupModel(t);await Promise.all(Array.from({length:20},(_,i)=>projectStore(e.home).save(e.id,{['field'+i]:i})));const p=await e.store.read(e.id);for(let i=0;i<20;i++)assert.equal(p['field'+i],i);assert.equal(JSON.parse(await readFile(`${e.home}/storages/meiji/projects/${e.id}.json`,'utf8')).schemaVersion,2)})
test('stale model task cannot overwrite a changed dependency',async t=>{const e=await setupModel(t),job=revisionStore(e.store,'task',{episodeId:e.episodeId,track:'S01'});await job.read(e.id);await scopeProjects(e.store,e.episodeId).save(e.id,p=>({summary:contentNode(p.summary,'新剧情')}));await assert.rejects(job.save(e.id,{title:'旧结果'}),{status:409})})
test('picture update marks old media stale without deleting text',()=>{const p=episodeFixture();setContent(p.shots.items[0].video,{url:'/old',status:'ready'},{passed:true,failures:[]});const next=staleMedia(p);assert.equal(next.shots.items[0].video.stale,true);assert.equal(next.shots.items[0].video.content.url,'/old');assert.equal(next.shots.items[0].storyboard.content.prompt.text,p.shots.items[0].storyboard.content.prompt.text)})
test('same asset may be used by two episodes; detach never deletes shared file',async t=>{
 const e=await setupModel(t),ref=await savePicture(e.home,Buffer.from('picture'),'image/png','characters','旅人'),second=episodeFixture()
 await e.store.save(e.id,p=>({episodes:[...p.episodes,second]}))
 for(const episodeId of [e.episodeId,second.id])await runOperation(e.op('use-asset',{episodeId,itemId:'C01',category:'characters',assetId:ref.assetId}),{home:e.home})
 await runOperation(e.op('clear-image',{itemId:'C01'}),{home:e.home})
 const p=await e.store.read(e.id);assert.equal(p.episodes[0].plot.characters.items[0].image.content,null);assert.equal(p.episodes[1].plot.characters.items[0].image.content.assetId,ref.assetId);assert.ok((await assetStore(e.home).file('characters',ref.assetId)).path)
})
for(const kind of ['character','part','pencil'])test(`${kind} preview publishes only after upload succeeds`,async t=>{
 const e=await pending(t,kind);assert.equal((await assetStore(e.home).list('characters')).length,0)
 await runOperation(e.operation,e.deps);const p=await e.read();const media=kind==='pencil'?p.shots.items[0].pencil.content:kind==='part'?p.plot.characters.items[0].clothes[0]:p.plot.characters.items[0].image.content
 assert.equal(media.imageUrl,'https://example.test/confirmed.png');assert.ok(media.assetId);assert.deepEqual(p.pendingImages,{});await assert.rejects(readImageDraft(e.home,e.draft.draftId),{code:'ENOENT'})
})
test('failed upload retains preview and original image for retry',async t=>{const e=await pending(t);await assert.rejects(runOperation(e.operation,{...e.deps,uploadGatewayFile:async()=>{throw new Error('上传失败')}}),/上传失败/);const p=await e.read();assert.ok(p.pendingImages[e.draft.draftId]);assert.equal(p.plot.characters.items[0].image.content,null);assert.equal((await assetStore(e.home).list('characters')).length,0)})
test('AI tool cannot approve an image; changed owner rejects preview',async t=>{const e=await pending(t);await assert.rejects(runOperation(e.operation,{home:e.home}),{status:403});await scopeProjects(e.store,e.episodeId).save(e.id,p=>{p.plot.characters.items[0].name='新身份';return {plot:p.plot}});await assert.rejects(runOperation(e.operation,e.deps),/对应内容已修改/)})
test('discard deletes only the draft',async t=>{const e=await pending(t);await runOperation({...e.operation,action:'discard-image'},e.deps);assert.deepEqual((await e.read()).pendingImages,{});assert.equal((await e.read()).plot.characters.items[0].name,'旅人')})
test('edit during image upload rejects stale association and cleans unbound asset',async t=>{const e=await pending(t);await assert.rejects(runOperation(e.operation,{...e.deps,uploadGatewayFile:async()=>{await scopeProjects(e.store,e.episodeId).save(e.id,p=>{p.plot.characters.items[0].name='新身份';return {plot:p.plot}});return {url:'https://example.test/image'}}}),{status:409});assert.equal((await assetStore(e.home).list('characters')).length,0);assert.equal((await e.read()).plot.characters.items[0].name,'新身份')})
