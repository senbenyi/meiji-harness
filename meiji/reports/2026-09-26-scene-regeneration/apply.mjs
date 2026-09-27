import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {projectStore} from '../../server/data/projects.js';
import {materialize,foldEpisode} from '../../server/data/episodes.js';
import {setCheck} from '../../server/data/self-checks.js';
import {staleMedia} from '../../server/flow/gates.js';
const dir=new URL('./',import.meta.url),home=process.cwd()+'/.dsh';
const id='7a8b0266-69c2-4122-9ec8-eeb7d285a0c9',eid='15442eeb-3592-4cab-a4f5-9ff424465b89';
const uploads=JSON.parse(await readFile(new URL('uploads.json',dir),'utf8'));
assert.equal(uploads.length,5);assert.ok(uploads.every(x=>x.verificationStatus===200));
const store=projectStore(home),before=await store.read(id);
assert.equal(before.revision,411);assert.ok(!before.activity&&!before.activeOperation);
const view=materialize(before,eid);assert.ok(!view.activity);
const original=structuredClone(view);
view.scenes.items=view.scenes.items.map(item=>{
 const next=uploads.find(x=>x.id===item.id);assert.ok(next);assert.notEqual(next.assetId,item.assetId);
 const {assetId,assetCategory,localPath,imageUrl}=next;
 return {...item,assetId,assetCategory,localPath,imageUrl};
});
setCheck(view,{action:'scenes'},[]);
for(const item of view.scenes.items){
 setCheck(view,{action:'image',itemId:item.id},[]);
 view.feedback['image:'+item.id].review.status='approved';
}
const reason='场景图已使用新版成图 skill 重新生成并替换；当前文本分镜仍保留旧图引用快照，需要按新场景图更新并重新自审。';
setCheck(view,{action:'storyboard'},[reason]);
for(const shot of view.shots?.items||[])setCheck(view,{action:'shot-storyboard',track:shot.id},[reason]);
Object.assign(view,staleMedia(view));
const saved=await store.save(id,current=>foldEpisode(current,eid,view),{expectedRevision:411});
const actual=materialize(await store.read(id),eid);
assert.deepEqual(actual.characters,original.characters);assert.deepEqual(actual.outline,original.outline);
assert.deepEqual(actual.storyboard,original.storyboard);
for(const item of actual.scenes.items)assert.equal(item.assetId,uploads.find(x=>x.id===item.id).assetId);
await writeFile(new URL('project-after.json',dir),JSON.stringify(saved,null,2));
console.log(JSON.stringify({revision:saved.revision,scenes:actual.scenes.items.map(x=>({id:x.id,name:x.name,assetId:x.assetId})),charactersAndOutlineUnchanged:true,storyboardsPreservedAndMarkedForReview:true},null,2));
