import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {projectStore} from '../../server/data/projects.js';
const dir=new URL('./',import.meta.url),store=projectStore(process.cwd()+'/.dsh');
const id='7a8b0266-69c2-4122-9ec8-eeb7d285a0c9',eid='15442eeb-3592-4cab-a4f5-9ff424465b89';
const before=await store.read(id);assert.ok(!before.activity&&!before.activeOperation);
const baseline=JSON.parse(await readFile(new URL('../2026-09-26-scene-direction/project-before.json',dir),'utf8'));
const prior=baseline.episodes.find(e=>e.id===eid);
const previous=before.episodes.find(e=>e.id===eid);assert.ok(!previous.activity);
await writeFile(new URL('project-before.json',dir),JSON.stringify(before,null,2));
const episode=structuredClone(previous),updates=[];
for(const board of episode.storyboard||[]){
 for(const ref of board.referenceSnapshot||[]){
  const bag=episode[ref.ownerId?'characters':ref.kind];
  const owner=bag?.items?.find(x=>x.id===(ref.ownerId||ref.id));
  const asset=ref.ownerId?owner?.[ref.slot]?.find(x=>x.id===ref.id):owner;
  if(!asset?.imageUrl)continue;
  if(ref.url!==asset.imageUrl){
   updates.push({shot:board.id,id:ref.id,oldUrl:ref.url,newUrl:asset.imageUrl});
   if(board.prompt?.text)board.prompt.text=board.prompt.text.split(ref.url).join(asset.imageUrl);
   ref.url=asset.imageUrl;ref.assetId=asset.assetId;
  }
  ref.name=asset.name;
  if(ref.kind==='scenes')ref.label=`场景「${asset.name}」`;
 }
}
const inserted=new Set([
 '场景已明确为虎牢关阵前及南城北敌的调度关系；旧图为通用战场，尚未按新设定成图，相关分镜保留为待更新稿。',
 '场景图已使用新版成图 skill 重新生成并替换；当前文本分镜仍保留旧图引用快照，需要按新场景图更新并重新自审。'
]);
const restored=[];
for(const [key,record] of Object.entries(episode.feedback)){
 if(!record.check.failures.some(x=>inserted.has(x)))continue;
 const remaining=record.check.failures.filter(x=>!inserted.has(x));
 const old=prior.feedback[key]?.check;
 record.check=remaining.length?{...record.check,passed:false,failures:remaining}:structuredClone(old||{passed:null,failures:[]});
 restored.push(key);
}
const saved=await store.save(id,{episodes:before.episodes.map(e=>e.id===eid?episode:e)},{expectedRevision:before.revision});
const actual=(await store.read(id)).episodes.find(e=>e.id===eid);
assert.deepEqual(actual.shots,previous.shots);assert.deepEqual(actual.characters,previous.characters);assert.deepEqual(actual.scenes,previous.scenes);assert.deepEqual(actual.outline,previous.outline);
for(let i=0;i<actual.storyboard.length;i++){
 let expected=previous.storyboard[i].prompt.text;
 for(const u of updates.filter(u=>u.shot===actual.storyboard[i].id))expected=expected.split(u.oldUrl).join(u.newUrl);
 assert.equal(actual.storyboard[i].prompt.text,expected);
}
const failures=Object.entries(actual.feedback).filter(([k,v])=> (k==='storyboard'||k.startsWith('storyboard:'))&&v.check.passed===false).map(([k,v])=>({key:k,reasons:v.check.failures}));
await writeFile(new URL('result.json',dir),JSON.stringify({revision:saved.revision,updates,restored,failures},null,2));
console.log(JSON.stringify({revision:saved.revision,updatedReferences:updates.length,restoredChecks:restored.length,remainingStoryboardFailures:failures},null,2));
