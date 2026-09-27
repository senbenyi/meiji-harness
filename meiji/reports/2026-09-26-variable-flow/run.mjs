import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {generateShots,generateShotSeconds,generateShotStoryboard} from '../../server/generate/shot-text.js';
import {projectStore} from '../../server/data/projects.js';
import {materialize,foldEpisode} from '../../server/data/episodes.js';
import {replaceFrom} from '../../server/flow/gates.js';
import {setCheck} from '../../server/data/self-checks.js';
import {shotReferenceImages} from '../../client/reference-images.js';
import {h3PromptFailures} from '../../server/generate/film.js';
import {normalizeScenes} from '../../server/generate/story.js';
import {costumes} from './costumes.mjs';
const dir=new URL('./',import.meta.url);
const json=async name=>JSON.parse(await readFile(new URL(name,dir),'utf8'));
const source=await json('source-project.json'),cards=await json('cards.json'),rows=await json('authored-shots.json');
assert.equal(normalizeScenes(cards.scenes).items.length,5);
assert.ok(cards.scenes.items.every(x=>x.imageUrl&&x.uploadVerification.status===200));
const id=source.id,eid='15442eeb-3592-4cab-a4f5-9ff424465b89',store=projectStore(process.cwd()+'/.dsh');
const fresh=await store.read(id);assert.equal(fresh.revision,source.revision);assert.ok(!fresh.activity&&!fresh.activeOperation);
let revision=fresh.revision;
const base=materialize(fresh,eid);
let p={...base,...replaceFrom(base,'scenes',{scenes:cards.scenes}),characters:cards.characters,activity:null,activityError:null};
setCheck(p,{action:'characters'},[]);setCheck(p,{action:'scenes'},[]);
for(const s of cards.scenes.items){setCheck(p,{action:'image',itemId:s.id},[]);p.feedback[`image:${s.id}`].review.status='approved';}
async function save(){await store.save(id,current=>foldEpisode(current,eid,p),{expectedRevision:revision});revision++;}
await save();
const table=rows.map(row=>`## ${row.id} / ${row.duration}s\n标题：${row.title}\n实际出镜：${row.cast.join('、')}。无独立辨识的群体按剧情保留。\n场景：${row.scenes.join('、')}\n起始状态：${row.start}\n事件过程：${row.segments.map(s=>s[1]).join(' ')}\n取景与空间：${row.segments.map(s=>s[3]+' '+s[5]).join(' ')}\n声音与对白：${row.segments.map(s=>s[7]).join(' ')}\n结束状态：${row.end}\n切段及接续理由：${row.boundary}\n本段${row.duration}秒，按动作完成点而非固定15秒截断。`).join('\n\n');
const calls=[];
const requestFor=(stage,text)=>async(skill,prompt)=>{
 calls.push({stage,skill,prompt});
 if(skill==='meiji-content-review')return 'PASS';
 return text;
};
p.shots=await generateShots({project:p,request:requestFor('镜头表',table)});
assert.equal(p.shots.check.passed,true);assert.equal(p.shots.items.reduce((n,s)=>n+s.duration,0),120);
setCheck(p,{action:'shots'},[]);p.stage='shots';await save();
let secondsFile='',boardsFile='';
for(const row of rows){
 const seconds=`${row.id} / ${row.duration}s\n\n`+row.segments.map(s=>`### ${s[0]}s\n- 动作：${s[1]}\n- 镜头：${s[3]}\n- 空间：${s[5]}\n- 声音：${s[7]}\n- 交接：${s[9]}`).join('\n\n');
 p.shots=await generateShotSeconds({project:p,shotId:row.id,request:requestFor(row.id+'每秒指令',seconds)});
 setCheck(p,{action:'shot-seconds',track:row.id},[]);secondsFile+=seconds+'\n\n---\n\n';
}
setCheck(p,{action:'seconds'},[]);await save();
for(const row of rows){
 const refs=shotReferenceImages(p,{characters:row.cast,scenes:row.scenes});
 const labels=new Map(refs.map((ref,i)=>[ref.name,`<Subject ${i+1}>`]));
 const replace=t=>{if(labels.has('贩毒头目'))t=t.replace(/the boss/gi,'贩毒头目');for(const [name,label] of labels)t=t.split(name).join(label);return t;};
 const env={E01:'the complete modern glass tower, south entrance and surrounding city, roof and base uncropped',E02:'the lobby and northward corridor with side doorways, turn at the north end and clear movement route',E03:'the switchback stairwell, complete landings and upper fire door; repeated floor layouts may be used across explicit time ellipses',E04:'the complete rooftop, southwest exit about three metres north of the southern parapet, northern HVAC bank about fifteen metres from that edge, open southern lateral route; do not move the exit north',E05:'the wide dry ancient battlefield with northern hills and distant earthworks at the sides, clear north-south charging lane'};
 const definitions=refs.map((ref,i)=>`<Subject ${i+1}> comes from <Picture ${i+1}>: ${ref.kind==='characters'?costumes[ref.name]:env[ref.id]}. ${ref.kind==='characters'?'Preserve facial identity, hair and anatomy, but use the story costume and pose; studio shorts, crop and background are not scene instructions.':'Preserve environmental landmarks and usable routes; reframe without cropping necessary action space.'}`).join('\n');
 let cut=1;
 const timeline=row.segments.map((s,i)=>`${i===0?'[Shot 1]':/^Cut |^After an explicit|^A second explicit|^Only at the instant/.test(s[2])||/^Cut /.test(s[4])?`[Shot ${++cut}]`:''} ${s[0]} seconds: ${replace([s[2],s[4],s[6],s[8],s[10]].join(' '))}`).join('\n');
 const retained=refs.map((ref,i)=>`<Subject ${i+1}>: partially_preserved — ${ref.kind==='characters'?'keep the distinct face and body, using the approved clothing, performance and scale':'keep the environment layout and depth, using the timeline viewpoint'}.`).join('\n');
 const prompt=`subject_definitions:\n${definitions}\n\nsummary: A ${row.duration}-second cinematic live-action drama clip. The comedic element is the narrative incongruity of unfamiliar circumstances, not slapstick injury. Maintain spatial and temporal continuity.\n\nretention_analysis:\n${retained}\n\ndetailed_description:\nUse ${row.scenes.map(n=>labels.get(n)).join(', ')} as the setting. Keep environmental depth and the stated body coverage.\n${timeline}\nUse only the actual bodies shown in this clip, no blended faces or unrequested flashback characters. Maintain handedness, weapon targets and heading; camera movement does not turn the actor. Establish new locations at the specified cut, never teleport within a continuous action. All dialogue is Mandarin Chinese and occurs exactly once where written. No visible timing, reference labels or subtitles.\n\noverall_soundscape: ${replace(row.segments.map(s=>s[8].replace(/<d>[\s\S]*?<\/d>/g,'[the single dialogue line already specified in the timeline]')).join(' '))} Carry ambience across continuous boundaries without replaying completed actions.\n\nnon_diegetic_music: N/A`;
 assert.deepEqual(h3PromptFailures(prompt,refs,'reference'),[],row.id);
 p.storyboard=await generateShotStoryboard({project:p,shotId:row.id,request:requestFor(row.id+'文本分镜',prompt)});
 const board=p.storyboard.find(b=>b.id===row.id);
 assert.deepEqual(board.referenceSnapshot.map(x=>x.url),refs.map(x=>x.url),row.id+' references');
 setCheck(p,{action:'shot-storyboard',track:row.id},[]);
 boardsFile+=`## ${row.id} / ${row.duration}s\n`+refs.map((ref,i)=>`Picture ${i+1}: ${ref.label} ${ref.url}`).join('\n')+'\n\n'+prompt+'\n\n---\n\n';
}
setCheck(p,{action:'storyboard'},[]);p.stage='storyboard';await save();
const after=await store.read(id),e=materialize(after,eid);
assert.equal(e.outline,base.outline);assert.equal(e.storyboard.length,12);
for(const shot of e.shots.items){
 const spans=[...shot.secondsText.matchAll(/### (\d+)–(\d+)s/g)].map(m=>[+m[1],+m[2]]);
 assert.equal(spans[0][0],0);assert.equal(spans.at(-1)[1],shot.duration);
 spans.forEach(([a,b],i)=>{assert.ok(b>a&&b-a<=5);if(i)assert.equal(a,spans[i-1][1]);});
}
for(const [file,data]of [['镜头表.md',table],['每秒指令.md',secondsFile],['文本分镜.md',boardsFile],['generated-episode.json',JSON.stringify(e,null,2)],['saved-project.json',JSON.stringify(after,null,2)],['request-records.json',JSON.stringify(calls,null,2)]])await writeFile(new URL(file,dir),data);
console.log(JSON.stringify({revision,shots:e.shots.items.map(s=>[s.id,s.duration]),storyboards:e.storyboard.length,scenes:e.scenes.items.length,total:e.shots.items.reduce((n,s)=>n+s.duration,0)},null,2));
