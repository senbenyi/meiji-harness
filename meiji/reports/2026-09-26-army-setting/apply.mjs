import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {projectStore} from '../../server/data/projects.js';
const store=projectStore(process.cwd()+'/.dsh'),id='7a8b0266-69c2-4122-9ec8-eeb7d285a0c9',eid='15442eeb-3592-4cab-a4f5-9ff424465b89',dir=new URL('./',import.meta.url);
const before=await store.read(id);assert.ok(!before.activity&&!before.activeOperation);await writeFile(new URL('before.json',dir),JSON.stringify(before,null,2));
const episodes=structuredClone(before.episodes),e=episodes.find(x=>x.id===eid);
const deployment='虎牢关在南、关门朝北。华雄骑马处于本方大军阵前，背后南侧及两翼是依托关城展开的密集军阵，旗帜翻动、长枪与盾列延伸；中央回关通道保持畅通。北方关东军同样横向排开大军，潘凤骑马位于其本方阵列之前、面朝南方华雄。两军之间留出宽阔交锋空地；潘凤初始距华雄约100米，随后独自从阵前策马冲锋，北方军阵留在他身后，不随他全军出击。群体规模以层层队列、旗阵和远近纵深呈现，不新增具名将领。';
e.summary+='\n\n古代场景补充：'+deployment;
e.outline=e.outline.replace('世界规则：','世界规则：').replace('因果剧情：','古代场景与阵位：'+deployment+'\n\n因果剧情：');
const scene=e.scenes.items.find(x=>x.id==='E05');scene.space=deployment+' 场景参考图为由北向南正对关门的空环境图，仅提供地形建筑，成片按剧情加入双方军阵；侧机位不能翻转阵位。';scene.landmark+=' 双方军阵在各自主将后方横向展开，中央对阵空地与回关通路清晰。';
const detail={
S09:'东侧全景建立：华雄在南侧本方阵前，面北，南侧及两翼大军在他身后依托关城排开；北侧敌方大军横向铺展为远景，不提前辨认潘凤。两阵旗帜、长枪和盾列形成多层纵深，中间空地畅通。',
S10:'双方大军延续既定阵位。东侧全景中本方军阵在华雄南侧身后，敌方军阵在北侧远处；东南侧反应镜仅保留能入画的阵列与旗帜，其余仍在既定画外方向。华雄始终位于阵前，没有退回军中。',
S11:'潘凤首次被辨认为北侧关东军阵前的黑袍骑将，身后大军横向排开；完整喊话后独自策马向南冲锋。华雄仍在南侧本方阵前，两支大军各在主将身后，东侧机位下华雄及本方在画面左侧、潘凤及敌方在右侧，中间保留冲锋通道。',
S12:'东北侧看华雄前侧时，南方本方军阵与关城在其身后，北方敌军在摄影机后方画外。切回东侧关系全景，两方军阵重新成为各自主将身后的层层背景；只有潘凤继续向南逼近，军阵不移动换边，不提前发生两军混战。'
};
const en={
S09:'Establish two substantial opposing armies across the broad plain. Subject 1 is mounted ahead of his own southern ranks, with dense spear-and-shield formations and banners behind and to his flanks near the gate, leaving a central return route clear. Northern enemy ranks spread across the distance; do not identify their challenger yet. Both armies have layered depth, not a handful of isolated extras.',
S10:'Keep both armies in their established positions: the mounted Subject 1 remains in front of the southern army, facing the northern enemy ranks. In the southeast reaction view retain the visible banners and ranks; formations outside the framing stay in their established offscreen directions. Neither army advances or changes allegiance.',
S11:'Subject 2 begins in front of the deployed northern army, whose dense ranks and banners extend behind him. After the existing complete challenge, only he rides south into the open lane. Subject 1 remains ahead of his own southern army near the gate. From the eastern camera looking west, the southern army is behind Subject 1 on screen-left and the northern army behind Subject 2 on screen-right. Keep the gap unobstructed; no general army charge.',
S12:'In the northeast reaction view, the southern army and gate remain behind Subject 1; the northern army is offscreen behind the camera. The return to the eastern wide view restores the layered ranks behind each champion. Only Subject 2 continues closing the gap. Both armies hold position; do not introduce a mass assault, melee, new commander or premature contact.'
};
for(const shot of e.shots.items){if(!detail[shot.id])continue;shot.text=shot.text.replaceAll('远处有小规模不可辨面部的军阵','双方大军在各自主将身后横向展开，远处面孔不必辨认')+'\n场景与背景活动：'+detail[shot.id];shot.secondsText=shot.secondsText.replaceAll('远处有小规模不可辨面部的军阵','双方大军在各自主将身后横向展开，远处面孔不必辨认')+'\n持续场景状态：'+detail[shot.id]+' 群阵仅有旗帜、兵器轻动和低沉人马声，声源保持在两侧远近阵位，不覆盖现有对白与逼近蹄声。';}
if(e.shots.rawText)e.shots.rawText=e.shots.items.map(s=>`## ${s.id} / ${s.duration}s\n${s.text}`).join('\n\n');
for(const b of e.storyboard){if(!en[b.id])continue;b.prompt.text=b.prompt.text.replace('with distant faceless ranks at the sides','with substantial opposing armies deployed behind their respective champions').replace('detailed_description:\n','detailed_description:\nBackground deployment: '+en[b.id]+' The empty environment reference does not remove these story-required armies.\n').replace('overall_soundscape:','overall_soundscape: Low distant human-and-horse murmur, occasional armour and spear movement, and banners moving in the wind remain anchored to the two stationary armies. Do not add intelligible commands or mask the existing dialogue and approaching hoofbeats.');}
const saved=await store.save(id,{episodes},{expectedRevision:before.revision});const actual=(await store.read(id)).episodes.find(x=>x.id===eid),old=before.episodes.find(x=>x.id===eid);
assert.deepEqual(actual.feedback,old.feedback);assert.deepEqual(actual.characters,old.characters);assert.deepEqual(actual.films,old.films);assert.deepEqual(actual.storyboard.map(x=>x.referenceSnapshot),old.storyboard.map(x=>x.referenceSnapshot));assert.deepEqual(actual.shots.items.slice(0,8),old.shots.items.slice(0,8));
await writeFile(new URL('after.json',dir),JSON.stringify(saved,null,2));console.log(JSON.stringify({revision:saved.revision,updatedShots:['S09','S10','S11','S12'],imagesAndReviewsUnchanged:true}));
