import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {projectStore} from '../../server/data/projects.js';
const dir=new URL('./',import.meta.url),id='7a8b0266-69c2-4122-9ec8-eeb7d285a0c9',eid='15442eeb-3592-4cab-a4f5-9ff424465b89';
const specs=JSON.parse(await readFile(new URL('prompts.json',dir),'utf8')),uploads=JSON.parse(await readFile(new URL('uploads.json',dir),'utf8'));
assert.equal(uploads.length,5);assert.ok(uploads.every(x=>x.verificationStatus===200));
const store=projectStore(process.cwd()+'/.dsh'),before=await store.read(id);assert.ok(!before.activity&&!before.activeOperation);
await writeFile(new URL('project-before-final.json',dir),JSON.stringify(before,null,2));
const p=structuredClone(before),e=p.episodes.find(x=>x.id===eid);
const replacements=[
 [/高达(?:五十|50)层的?写字楼/g,'废弃烂尾楼'],[/现代(?:五十|50)层写字楼/g,'废弃烂尾楼'],[/(?:五十|50)层写字楼/g,'废弃烂尾楼'],[/写字楼/g,'废弃烂尾楼'],[/(?:全部)?(?:五十|50)层/g,'多层'],
 [/玻璃幕墙/g,'裸露混凝土外墙与空窗洞'],[/玻璃塔楼/g,'未完工混凝土楼体'],[/玻璃大楼/g,'未完工混凝土大楼'],[/顶部白灯|室内顶灯补光/g,'空窗洞自然采光'],[/空调机组|机组/g,'未完工设备基座'],[/机械低鸣|机械嗡鸣/g,'风穿过空洞的低鸣'],
 [/fifty-storey tower/gi,'unfinished concrete building'],[/fifty-storey/gi,'unfinished'],[/50-storey/gi,'unfinished'],[/modern glass tower/gi,'abandoned unfinished concrete building'],[/glass tower/gi,'unfinished concrete building'],[/glass facade/gi,'bare concrete facade with empty window openings'],[/office (?:tower|building)/gi,'abandoned unfinished building'],[/HVAC bank/gi,'unfinished masonry equipment plinths'],[/HVAC cover/gi,'unfinished masonry cover'],[/northern machinery/gi,'northern masonry structures'],[/low mechanical hum/gi,'low wind through empty openings'],[/short southwest movement/gi,'short eastward movement within the southern roof area'],
 [/the wide dry ancient battlefield with northern hills and distant earthworks at the sides, clear north-south charging lane/g,'the broad open plain outside Hulao Pass, the south gate facing north with the gatehouse behind Hua Xiong, a vast northern deployment area and clear north-south charging route; the reference camera is north of the gate looking south, while video camera positions follow the timeline'],
 [/The glass tower rises above the surrounding blocks/g,'The abandoned unfinished building stands apart from the surrounding blocks'],
];
function rewrite(v){if(typeof v==='string'){for(const [a,b]of replacements)v=v.replace(a,b);return v;}if(Array.isArray(v))return v.map(rewrite);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,['reviewText','secondsReviewText','feedback','review','check'].includes(k)?x:rewrite(x)]));return v;}
for(const key of ['summary','script'])if(p[key])p[key]=rewrite(p[key]);
for(const key of ['summary','brief','outline','shots','storyboard'])if(e[key])e[key]=rewrite(e[key]);
e.outline=e.outline.replace('眼前是开阔战场、翻卷尘土和远处阵势','眼前是虎牢关阵前可供大军部署的开阔平原、翻卷尘土和远处阵势');
const world='场景固定方位：虎牢关在南、关门朝北；华雄背城面北，潘凤从北向南迎来。城门正面参考图由北向南拍摄，视频机位可依分镜变化，不能因此翻转地形。关前平原横向开阔、可部署大军，远山不夹窄行动区域。';
e.scenes.items=e.scenes.items.map(s=>{const spec=specs.find(x=>x.id===s.id),u=uploads.find(x=>x.id===s.id);const next={...rewrite(s),name:spec.name,look:spec.prompt,assetId:u.assetId,assetCategory:u.assetCategory,localPath:u.localPath,imageUrl:u.imageUrl,uploadVerification:{status:200,contentType:'image/png'}};if(s.id==='E05'){next.landmark=world;next.space=world+' 华雄位于关门外约30米；潘凤初始位于其北方约100米，两者之间无遮挡，背后回关路线畅通。';}else next.light='冷峻阴天白昼；室内仅由空窗洞和门洞自然采光，无运行照明。';return next;});
const orientations={
 S01:'Opening camera south of the team looking north: their backs face the lens as they advance toward the entrance. At the cut, the camera is east looking west, seeing their right profiles; north and the target doorway are screen-right, south is screen-left. Bodies and guns remain northward; the cut does not turn the actors.',
 S02:'Camera east of the northbound route, looking west about five metres from the team: police right profiles face screen-right toward the northern opponents; opposing gunmen face south, screen-left. Keep the south entrance behind the police at screen-left. Track north without crossing the action axis.',
 S03:'Camera stays east looking west: on the east stair flight the pursuing bodies face north, screen-right; on the next west flight they face south, screen-left. Turn continuously only at the actual landing, not for the camera. At the top, turn north through the roof doorway; show right profiles and keep the pursuer behind the leader. Ellipses change floor level, not this layout.',
 S04:'Camera east looking west at a wide distance: north is screen-right, south screen-left. The two officers face north with right profiles visible; the boss faces south toward them with his left profile visible. The captain remains southwest behind Subject 1, clear of the southern retreat route. Their eastward sidestep moves toward the camera without turning their torsos.',
 S05:'Maintain the east-side camera looking west: Subject 1 faces north, screen-right, while stepping backward south, screen-left. The boss remains in northern cover at screen-right facing south; the captain is southwest behind Subject 1. Show Subject 1 from his right side; no turn toward the lens.',
 S06:'First view is east looking west, showing Subject 1 right profile facing north. At the southeast camera cut looking northwest, about five metres away, see his right-rear three-quarter body; the captain remains southwest of him, on the screen-left rear, aiming northeast into his back. The northern boss remains beyond them. Do not turn Subject 1 to show his chest; convey the exit mark without a new camera-facing pose.',
 S07:'From the southeast looking northwest, retain Subject 1 right-rear body view while his head alone turns left toward the southwest captain. Do not rotate his torso to manufacture a frontal view. The eastern cut looks west: south and the backward fall are screen-left, north screen-right. Track down outside the southern facade; his front rotates upward toward the sky as the fall begins.',
 S08:'The exterior camera remains east of the fall path looking west and tracking downward outside the south facade. Show the falling body side-on with chest toward the sky, roof above and ground below; never turn him upright or toward the lens. The ground-instant subjective cut looks upward from his existing face-up orientation, then closes into darkness.',
 S09:'Camera east of the mounted rider looking west: the horse and rider face north, screen-right, showing their right sides. Hulao gate remains south behind them at screen-left; the northern open approach is screen-right. The frontal gate reference establishes architecture, not a forced video viewpoint. Keep complete horse and rider visible.',
 S10:'The initial east-side view looks west, showing the north-facing rider right profile. The southeast reaction camera looks northwest, showing his right-rear three-quarter body, saddle and hands; do not demand a frontal face from this position. His gaze lifts toward north in the screen-right looking space; his torso and horse keep their established heading.',
 S11:'Camera remains east looking west: Hua Xiong is south at screen-left facing north/screen-right, with his right side visible; Pan Feng is north at screen-right facing south/screen-left, with his left side visible. His approach moves right-to-left toward Hua Xiong. The south gate stays behind Hua Xiong, not behind the approaching challenger.',
 S12:'At the northeast reaction camera looking southwest, see the north-facing Hua Xiong front-right three-quarter body without turning him; Pan Feng approaches from north behind the camera. At the eastern spatial cut looking west, Hua Xiong returns to screen-left facing right and Pan Feng to screen-right facing left. Keep the gap and complete horses visible; do not mirror the gate or reverse the charge.'
};
for(const b of e.storyboard){
 for(const ref of b.referenceSnapshot||[]){if(ref.kind!=='scenes')continue;const s=e.scenes.items.find(s=>s.id===ref.id);assert.ok(s);b.prompt.text=b.prompt.text.split(ref.url).join(s.imageUrl);Object.assign(ref,{url:s.imageUrl,assetId:s.assetId,name:s.name,label:`场景「${s.name}」`});}
 b.prompt.text=b.prompt.text.replace('detailed_description:\n',`detailed_description:\nSpatial orientation for this clip: ${orientations[b.id]}\n`);
 // Preserve literal dialogue rather than reading reference labels aloud.
 b.prompt.text=b.prompt.text.replace('<d>[Mandarin Chinese] <Subject 1>匹夫，我<Subject 2>来也！</d>','<d>[Mandarin Chinese] 华雄匹夫，我潘凤来也！</d>');
}
// Completed clips are retained as history; no generation or review stage is rerun.
for(const film of Object.values(e.films||{}))if(film.status==='ready')film.status='stale';
if(e.assembly)e.assembly.status='stale';
const saved=await store.save(id,{summary:p.summary,script:p.script,episodes:p.episodes},{expectedRevision:before.revision});
const actual=(await store.read(id)).episodes.find(x=>x.id===eid);
assert.deepEqual(actual.characters,before.episodes.find(x=>x.id===eid).characters);
assert.deepEqual(actual.feedback,before.episodes.find(x=>x.id===eid).feedback);
assert.equal(actual.storyboard.length,12);assert.equal(actual.shots.items.length,12);
const activeText=JSON.stringify([saved.summary,saved.script,actual.summary,actual.outline,actual.scenes,actual.shots.items.map(x=>[x.text,x.secondsText]),actual.storyboard.map(x=>x.prompt.text)]);
assert.ok(!/五十层|50层|fifty-storey|写字楼/.test(activeText));
await writeFile(new URL('project-after.json',dir),JSON.stringify(saved,null,2));
console.log(JSON.stringify({revision:saved.revision,images:uploads.length,orientationUpdated:12,feedbackUnchanged:true,charactersUnchanged:true},null,2));
