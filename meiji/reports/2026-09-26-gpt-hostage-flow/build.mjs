import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {shotReferenceImages} from '../../client/reference-images.js';
import {h3PromptFailures} from '../../server/generate/film.js';
import {readShotSections} from '../../server/generate/shot-text.js';
const dir=new URL('./',import.meta.url),read=async n=>JSON.parse(await readFile(new URL(n,dir),'utf8'));
const before=await read('before.json'),e=before.episodes[0],rows=await read('authored-rows.json'),english=await read('english.json');
const identities={
'黄征':'a 38-year-old Chinese police officer with a short crew cut, rectangular face and light stubble, in a dark navy tactical uniform, vest, trousers and black boots. His weapon state follows this clip: after placing his pistol on the roof he remains empty-handed',
'队长':'a stocky 46-year-old Chinese police captain with short side-parted hair, broad clean-shaven square face, in navy long sleeves, trousers and black boots, carrying a police pistol',
'贩毒头目':'a lean 43-year-old Chinese gang leader with slicked-back short hair, narrow clean-shaven face and an old left-eyebrow scar, in a grey jacket, black trousers and shoes; his right hand holds a pistol until it drops when he falls',
'周诚':'a distinct 32-year-old Chinese male building caretaker held hostage, with short textured hair, oval clean-shaven face and a slim ordinary build, in a light-grey work jacket, dark trousers and worn trainers. He is unarmed',
'华雄':'a distinct broad-shouldered ancient Chinese warrior with long hair in a topknot, broad square face and dense short beard, dark iron armour over a muted red tunic and leather boots; already mounted on a tall dark bay horse, right hand holding a red-tasselled spear and left holding reins. This is the ancient body, not the modern police officer face',
'潘凤':'an ancient Chinese warrior with a long face, arched brows, hooked nose and long chin beard, a black robe over iron armour; riding a dark horse, right hand spear, left hand reins, facing south toward the opponent'
};
const environments={
E01:'the abandoned unfinished concrete building, bare concrete columns and empty window openings, south entrance and surrounding urban depth; no fixed floor count or completed glass curtain wall',
E02:'the unfinished building corridor, southern entrance leading north through bare columns and deep door openings toward the stair turn, natural daylight through empty windows, construction debris only along edges',
E03:'the unfinished switchback concrete stairs, rough brick, open windows and rusty temporary railings. The higher landing reveals low neighbouring rooftops below; the final landing has no continuing upward flight and opens onto roof sky. Time cuts distinguish levels; do not invent floor numerals',
E04:'the unfinished roof, southwest stair exit, northern masonry equipment plinths and low southern parapet. Keep the central and southern paths clear. Overcast daylight, wind and dusty concrete; no running air-conditioning units. The environment photograph defines geometry rather than a mandatory first frame',
E05:'the broad open plain north of Hulao gate. The gate stands south facing north; its frontal reference was photographed from the north looking south. Video viewpoints follow the timeline without mirroring terrain. Friendly ranks deploy south behind Hua Xiong and enemy ranks north behind Pan Feng; the empty reference is not a requirement to omit armies'
};
const spaces={
S01:'南侧入口在北前方，东侧机位朝西时北右南左；黄征在前、队长在后约两米，警员沿侧面掩护。',
S02:'警队在南、匪徒在北，东侧朝西保持南左北右；倒地者与武器留在已控制的通道，不出现在楼梯。',
S03:'同一楼层内按真实楼梯折返，东侧朝西以北右南左为方位；两次硬切各自表明省略后的更高楼层。头目和人质领先，警察随后，留守者在下方。',
S04:'出口西南，低墙南，头目人质在北侧基座；头目枪指黄征，队长落在黄征西南后方。以两人构图交替，另一对留在既定画外。',
S05:'黄征移到南缘偏东面北举手，头目在北侧面南指枪，队长西南侧后方；东侧朝西为北右南左，人质紧挨头目但不替代其身份。',
S06:'黄征南缘偏东、队长西南、头目北侧，队长至头目为东北向射线，头目至黄征为南向射线；人质先在西侧基座后完全脱离两条射线。',
S07:'黄征面北、回看西南队长后向南失衡；东侧朝西时后退到画面左。队长不挡落点，北侧头目倒地、人质藏在掩体后均不入画。',
S08:'黄征在南侧外立面外仰面下坠，镜头从东侧看西随下降；主观段仍朝天，漩涡只在落地瞬间出现。',
S09:'虎牢关南、本方军阵南，华雄在本方阵前面北；敌军北侧远处，东侧向西北右南左，完整两阵和交战空地。',
S10:'华雄人马面北、右枪左缰；东侧见右侧，东北朝西南见右前侧，本方军阵和南关城在身后，北方来声在后一个机位的后方。',
S11:'华雄南侧面北、潘凤北侧面南，二人各在本方军阵前；东侧向西北右南左，潘凤由右向左，只单骑逼近。',
S12:'东北看华雄前侧时潘凤在北后方画外；切东侧时华雄左、潘凤右，两阵不换边，结尾仍未接触。'
};
const handoffs={
S01:['队伍仍在接近门口，黄征领先，枪声来自楼内。','黄征停在门外门槛，队长与警员已掩护，下一镜才进门。'],
S02:['双方仍依掩体交火，警队已在通道内。','第一匪徒倒地弃枪，第二匪徒退到北侧柱后。','两匪徒失去反抗能力，警员控制现场，两主角追向楼梯。'],
S03:['最后一名手下倒地受控，头目仍在更高平台。','头目控制人质向上撤，警察在下方跟进。','头目人质已出门，两警察到末端平台门内。','头目人质到北侧基座，两警察仍在门槛内准备出门。'],
S04:['两警察已上天台，头目人质在北侧画外。','头目命令已说完，枪口仍指南，人质未脱困。','队长命令结束，黄征准备放枪。','枪留地面，黄征已起身举空手，队长仍西南。'],
S05:['黄征沿南缘移到指定位置，双手未放下。','黄征站定，第一句谈判结束。','头目要求后退已说完，人质仍被控制。','黄征空手贴近低墙，队长获得清晰射线但未抬枪。'],
S06:['指控完整，人质已俯身离开控制、缩向西侧掩体。','人质完全遮蔽且离开射线，队长瞄准头目，头目仍瞄黄征。','两枪发生，头目倒地落枪，黄征胸口受击但仍站立。','黄征空手站立喘息，队长仍指头目，下一镜才识破并失衡。'],
S07:['黄征已明白内鬼身份，未说出完整话，开始失稳。','身体越过低墙，腿尚接触墙沿。','双脚离墙，仰面下坠中，下一镜延续坠落。'],
S08:['仍仰面下落接近地面，无漩涡。','落地瞬间主观黑暗涌来，准备闭眼。','已黑场，马鼻息先接入，尚无古代身体。'],
S09:['已在鞍上开始睁眼，右枪左缰，两军阵位建立。','已经睁眼并感到坐骑，不再重复苏醒或上马。'],
S10:['已看见陌生甲胄和长枪，仍面北在马上。','陌生感以停顿表现，仍未看见潘凤。','已看向北方来声，下一镜才揭示挑战者。'],
S11:['完整喊话结束，潘凤尚未加速，华雄保持原位。','潘凤单骑冲锋开始，间隔缩短，华雄未迎击。'],
S12:['枪缰握紧，潘凤画外逼近未中断。','双方约20–30米未接触，第一击留给下一集，音画继续。']
};
const shots=[],boards=[];let table='',secondsDoc='',boardsDoc='';
for(const row of rows){
 const duration=Number(row.segments.at(-1)[0].split('–')[1]);
 assert.equal(english[row.id].length,row.segments.length);
 let end=0;for(const [t]of row.segments){const [a,b]=t.split('–').map(Number);assert.equal(a,end);assert.ok(b>a&&b-a<=5);end=b;}
 const text=`标题：${row.title}\n起始状态：${row.segments[0][1]}\n实际出镜：${row.cast.join('、')}。镜内分组构图，同框最多三个重要人物，群演另计。\n场景：${row.scene}\n事件过程：${row.segments.map(x=>x[1]).join(' ')}\n机位、景别与环境：${row.segments.map(x=>x[2]).join(' ')}\n空间基准：${spaces[row.id]}\n声音与对白：${row.segments.map(x=>x[3]).join(' ')}\n切镜安排：${row.cuts.length>1?row.cuts.slice(1).map(t=>t+'秒').join('、')+'按上述取景切换；其他时段保持连续。':'本片段内无剪辑切镜，沿既定机位连续拍摄。'}\n结束状态：${handoffs[row.id].at(-1)}\n片段边界：在此结果处分段，以末态和环境关系重建下一镜；不重复动作，不虚构关键帧。目标${duration}秒。`;
 const secondsText=`${row.id} / ${duration}s\n\n`+row.segments.map(([t,a,c,au],i)=>`### ${t}s\n- 动作：${a}\n- 镜头：${c}\n- 空间：${spaces[row.id]}\n- 声音：${au}\n- 交接：${handoffs[row.id][i]}`).join('\n\n');
 shots.push({id:row.id,duration,text,cast:row.cast,scene:row.scene,secondsText,seconds:[],format:'text',secondsReviewText:'PASS'});
 const images=shotReferenceImages(e,{characters:row.cast,scenes:[row.scene]});assert.ok(images.length&&images.every(x=>/^https?:/.test(x.url)));
 const labels=new Map(images.filter(x=>x.kind==='characters').map((x,i)=>[x.name,`<Subject ${images.indexOf(x)+1}>`]));
 const replaceNames=text=>text.split(/(<d>[\s\S]*?<\/d>)/g).map(part=>part.startsWith('<d>')?part:[...labels].reduce((s,[n,l])=>s.split(n).join(l),part)).join('');
 const definitions=images.map((x,i)=>`<Subject ${i+1}> comes from <Picture ${i+1}>: ${x.kind==='characters'?(x.name==='黄征' ? identities[x.name].split('. His weapon')[0]+(Number(row.id.slice(1))<4?'; he carries his police pistol in this clip':row.id==='S04'?'; he carries his pistol initially, then puts it down and raises empty hands as timed below':'; he has already put his pistol down and remains empty-handed throughout this clip') : x.name==='贩毒头目' ? identities[x.name].replace('until it drops when he falls','as directed by this clip timeline') : identities[x.name]):environments[x.id]}. ${x.kind==='characters'?'Preserve the distinct face, hair and anatomy; use the story clothes and pose, not the reference portrait crop, studio background or shorts.':'Preserve landmarks and useful spatial relationships, adapting the viewpoint to the timeline.'}`).join('\n');
 const envLabel=`<Subject ${images.length}>`;
 let shotNumber=0;
 const timeline=english[row.id].map((s,i)=>{const start=Number(row.segments[i][0].split('–')[0]);const cut=row.cuts.includes(start);if(cut)shotNumber++;return `${cut?'[Shot '+shotNumber+'] ':''}${i===0?'Cinematic live-action. ':''}${start}–${row.segments[i][0].split('–')[1]} seconds: ${replaceNames(s)}`;}).join('\n');
 const participants=images.filter(x=>x.kind==='characters').map((x,i)=>`<Subject ${i+1}>`).join(', ');
 const prompt=`subject_definitions:\n${definitions}\n\nsummary: [reference generation] A ${duration}-second cinematic live-action sequence in ${envLabel} with ${participants}. ${Number(row.id.slice(1))<9?'Treat the raid, hostage danger and betrayal with urgency and gravity; no comic performance.':'The absurdity is the unfamiliar identity and renewed danger, not slapstick.'}\n\nretention_analysis:\n${images.map((x,i)=>`<Subject ${i+1}>: partially_preserved — ${x.kind==='characters'?'retain physical identity while following the timeline clothing, posture and actions':'retain the environment layout and depth; populated activity and camera framing follow the story'}.`).join('\n')}\n\ndetailed_description:\nUse ${envLabel} as the setting. Start directly with the specified action and framing; none of the reference images is a supplied first frame. Do not insert a portrait, a reference-image display, or a close-up before the scene.\n${timeline}\nKeep continuous body headings, prop hands, targets and completed-action states. Reposition the camera rather than turning an actor merely to show a face. Respect offscreen locations and do not force every referenced character into every frame. No visible timestamps, reference labels or subtitles. Spoken dialogue is Mandarin Chinese and occurs only where written.\n\noverall_soundscape: ${Number(row.id.slice(1))<9?'Retain the timed physical sounds above: sources stay anchored to their described rooms, people and directions. Indoor echoes give way to roof wind, then falling air only at the stated transitions. Do not add a sound source from another scene.':'Sustain open plain wind, banners, low distant human-and-horse murmur at both stationary formations, and near tack and armour. The approaching hoofbeats develop from the north only when specified.'} Carry continuous ambience across cuts without replaying an action or repeating any complete line of dialogue.\n\nnon_diegetic_music: N/A`;
 assert.deepEqual(h3PromptFailures(prompt,images,'reference'),[],row.id);
 boards.push({id:row.id,title:row.title,duration,format:'text',video:'reference',scene:row.scene,scenes:[row.scene],characters:row.cast,referenceSnapshot:structuredClone(images),prompt:{text:prompt},reviewText:'PASS'});
 table+=`## ${row.id} / ${duration}s\n${text}\n\n`;secondsDoc+=secondsText+'\n\n---\n\n';boardsDoc+=`## ${row.id} / ${duration}s\n`+images.map((x,i)=>`Picture ${i+1}: ${x.label} ${x.url}`).join('\n')+'\n\n'+prompt+'\n\n---\n\n';
}
assert.equal(shots.reduce((n,s)=>n+s.duration,0),120);assert.equal(readShotSections(table).length,12);
await writeFile(new URL('generated.json',dir),JSON.stringify({shots:{items:shots,rawText:table,format:'text',reviewText:'PASS'},storyboard:boards},null,2));
await writeFile(new URL('镜头表.md',dir),table);await writeFile(new URL('每秒指令.md',dir),secondsDoc);await writeFile(new URL('文本分镜.md',dir),boardsDoc);
console.log(JSON.stringify({shots:shots.length,totalSeconds:120,storyboards:boards.length,referenceCounts:boards.map(x=>[x.id,x.referenceSnapshot.length])}));
