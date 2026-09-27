import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {shotReferenceImages} from '../../client/reference-images.js';
import {h3PromptFailures} from '../../server/generate/film.js';
import {projectStore} from '../../server/data/projects.js';
import {materialize,foldEpisode} from '../../server/data/episodes.js';
import assert from 'node:assert/strict';
const dir=new URL('./',import.meta.url),json=async name=>JSON.parse(await readFile(new URL(name,dir),'utf8'));
const source=await json('source-project.json'), cards=await json('cards.json'), authored=await json('authored-shots.json');
const episodeId='15442eeb-3592-4cab-a4f5-9ff424465b89';
const base=materialize(source,episodeId);
const p={...base,...cards,shots:{items:[]},storyboard:[],films:{},boards:{},assembly:null,pendingImages:{},stage:'storyboard',activity:null,activityError:null};
const costumes={
 '黄征':'a modern Chinese police officer, short crew cut, rectangular face and light stubble, wearing a dark navy tactical uniform, vest, trousers and black boots; holding a police pistol until the fall',
 '队长':'a stocky middle-aged Chinese police captain, short side-parted hair, broad square clean-shaven face, wearing a navy long-sleeved uniform, trousers and black boots; holding a police pistol',
 '贩毒头目':'a lean middle-aged Chinese gang leader with slicked-back short hair, narrow clean-shaven face and a faint old left-eyebrow scar; grey jacket, black trousers and shoes, holding a pistol',
 '华雄':'a distinct broad-shouldered ancient Chinese warrior with long hair tied in a topknot, broad square face and a dense short beard, wearing dark iron armour over a muted red tunic and leather boots; already mounted on a tall dark bay horse, right hand holding a red-tasselled spear and left holding reins',
 '潘凤':'an ancient Chinese warrior with a long face, arched brows, hooked nose and long chin beard, wearing a black robe over iron armour; riding a dark horse south with spear in his right hand and reins in his left'
};
const findings={
 S01:[],S02:[],
 S03:['空间细化冲突：场景卡为南北60米天台，参考图西侧出口靠近北机组；本镜只写入场及向南退两小步，却落在南缘半步处，缺少由出口到南缘的可执行路线和时间。'],
 S04:[],S05:[],S06:[],S07:[],S08:[]
};
const review=(failures=[])=>({check:{passed:!failures.length,failures},review:{status:'pending',text:'',history:[]}});
p.feedback=structuredClone(base.feedback||{});
p.feedback.outline.review.status='approved';
p.feedback.characters=review();p.feedback.scenes=review();
let allTable='',allSeconds='',allBoards='';
for(const row of authored){
 const text=`${row.id} / 15s · ${row.title}\n叙事任务：${row.task}\n起始状态：${row.start}\n实际出镜：${row.cast.join('、')}。无名警员、匪徒或远处军阵只按本镜描述作为背景群体。\n场景：${row.scene||'写字楼入口与楼内通道（未有独立场景图）'}。\n主要景别：环境与动作关系使用全景/中远景；仅有新信息的确认反应使用短中景，不用满脸特写。\n事件：${row.segments.map(s=>s[1]).join(' ')}\n切镜依据：${row.cuts}\n声音：${row.segments.map(s=>s[7]).join(' ')}\n结束状态：${row.end}`;
 const secondsText=`${row.id} / 15s\n\n`+row.segments.map(s=>`### ${s[0]}s\n- 动作：${s[1]}\n- 镜头：${s[3]}\n- 空间：${s[5]}\n- 声音：${s[7]}\n- 交接：${s[9]}`).join('\n\n');
 const s={id:row.id,duration:15,title:row.title,cast:row.cast,scene:row.scene,format:'text',text,secondsText,reviewText:findings[row.id].length?'FAIL\n'+findings[row.id].join('\n'):'PASS'};
 p.shots.items.push(s);
 const refs=shotReferenceImages(p,{characters:row.cast,scenes:row.scene?[row.scene]:[]});
 const labels=new Map(refs.map((ref,i)=>[ref.name,`<Subject ${i+1}>`]));
 const replaceNames=t=>{if(labels.has("贩毒头目")) t=t.replace(/the boss/gi,"贩毒头目");for(const [name,label]of labels)t=t.split(name).join(label);return t};
 const definitions=refs.map((ref,i)=>`<Subject ${i+1}> comes from <Picture ${i+1}>: ${ref.kind==='characters'?costumes[ref.name]:ref.id==='E01'?'the spacious concrete rooftop with northern HVAC cover, western stair exit, southern low parapet and deep city skyline':'the open dry battlefield, distant northern hills and east/west earthworks, unobstructed charging lane under harsh daylight'}. ${ref.kind==='characters'?'Use the reference only for facial identity, hair and body proportions. Follow the stated story costume, not bare skin or black studio shorts; do not copy reference crop, pose or background.':'Use environmental layout and materials; do not add people from the reference. Keep required routes and scale visible.'}`).join('\n');
 let n=1;
 const timeline=row.segments.map((s,i)=>{
 const cut=/^Cut |^After an explicit|^A second explicit|^Enter antiquity|^Only at the instant/.test(s[2])||/^Cut /.test(s[4]);
 const marker=i===0?'[Shot 1]':cut?`[Shot ${++n}]`:'';
 return `${marker} ${s[0]} seconds: ${replaceNames([s[2],s[4],s[6],s[8],s[10]].join(' '))}`;
 }).join('\n');
 const sceneUse=row.id==='S06'?`${labels.get(row.scene)} is the battlefield reference and applies only after the cut at 9 seconds. Before that use the modern exterior facade and subjective blackout; the ancient body appears only after 9 seconds and the modern body only before blackout. Never combine the two faces or bodies.`:row.scene?`Use ${labels.get(row.scene)} as the environment throughout this clip.`:'No environment image is provided; create the described modern building environment from text, keeping its continuity provisional.';
 const retention=refs.map((ref,i)=>`<Subject ${i+1}>: partially_preserved — ${ref.kind==='characters'?'retain identity and anatomy; story wardrobe, action, viewpoint and relative size follow the timeline, not the studio image':'retain recognizable setting and spatial landmarks; framing follows the action, and background remains legible'}.`).join('\n');
 const prompt=`subject_definitions:\n${definitions}\n\nsummary: A fifteen-second live-action cinematic drama segment in portrait composition. Comic tone comes from narrative incongruity, not slapstick violence. Preserve the approved event order and end before events assigned to the next clip.\n\nretention_analysis:\n${retention}\n\ndetailed_description:\n${sceneUse}\n${timeline}\nMaintain distinct identities, costumes, hands, orientations and established object targets. Anonymous background extras have stable roles and no featured close-up faces. No more than three principal people appear simultaneously; sequential appearances do not imply simultaneous presence. All spoken dialogue is Mandarin Chinese; do not add, translate or repeat dialogue. Timing and reference labels are instructions, never visible graphics.\n\noverall_soundscape: ${replaceNames(row.segments.map(s=>s[8].replace(/<d>[\s\S]*?<\/d>/g,'[the dialogue specified once in the timeline]')).join(' '))} Keep continuing ambience across clip boundaries and do not replay completed gunshots.\n\nnon_diegetic_music: N/A`;
 const structural=h3PromptFailures(prompt,refs,'reference');assert.deepEqual(structural,[],row.id);
 p.storyboard.push({id:row.id,duration:15,title:row.title,format:'text',video:'reference',scene:row.scene,scenes:row.scene?[row.scene]:[],characters:row.cast,referenceSnapshot:refs,prompt:{text:prompt},reviewText:s.reviewText});
 p.feedback[`shot:${row.id}`]=review(findings[row.id]);
 p.feedback[`seconds:${row.id}`]=review(findings[row.id].map(f=>'上游未解决：'+f));
 p.feedback[`storyboard:${row.id}`]=review(findings[row.id].map(f=>'上游未解决：'+f));
 allTable+=text+'\n\n---\n\n';allSeconds+=secondsText+'\n\n---\n\n';allBoards+=`## ${row.id}\n\n`+refs.map((ref,i)=>`Picture ${i+1}：${ref.label} — ${ref.url}`).join('\n')+'\n\n'+prompt+'\n\n---\n\n';
}
const failures=Object.values(findings).flat();p.shots.check={passed:!failures.length,failures};
for(const key of ['shots','seconds','storyboard'])p.feedback[key]=review(failures);
for(const item of [...p.characters.items,...p.scenes.items])p.feedback[`image:${item.id}`]={...review(),review:{status:'approved',text:'用户授权本轮直接上传；GPT已目视检查。C02采用完整服装安全替代版本，差异见报告。',history:[]}};
for(const [name,data]of [['镜头表.md',allTable],['每秒指令.md',allSeconds],['文本分镜.md',allBoards],['generated-episode.json',JSON.stringify(p,null,2)]])await writeFile(new URL(name,dir),data);
const store=projectStore(process.cwd()+'/.dsh');
const fresh=await store.read(source.id);assert.equal(fresh.revision,405,'数据已变化，停止覆盖');assert.ok(!fresh.activity&&!fresh.activeOperation);
await store.save(source.id,current=>foldEpisode(current,episodeId,p),{expectedRevision:405});
const saved=materialize(await store.read(source.id),episodeId);
assert.equal(saved.shots.items.length,8);assert.equal(saved.storyboard.length,8);assert.equal(saved.shots.items.reduce((a,s)=>a+s.duration,0),120);assert.equal(saved.outline,base.outline);
await writeFile(new URL('saved-project.json',dir),JSON.stringify(await store.read(source.id),null,2));
console.log(JSON.stringify({saved:true,revision:saved.revision,characters:5,scenes:2,shots:8,storyboards:8,failures},null,2));
