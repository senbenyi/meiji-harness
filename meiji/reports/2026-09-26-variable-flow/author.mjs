import {readFile,writeFile} from 'node:fs/promises';
const dir=new URL('./',import.meta.url);
const old=JSON.parse(await readFile(new URL('../2026-09-26-gpt-flow/authored-shots.json',dir),'utf8'));
const rows=[];
const seg=(i,j,time,changes={})=>Object.assign(structuredClone(old[i-1].segments[j]),{0:time},changes);
function add(title,duration,cast,scenes,start,end,boundary,segments){rows.push({id:'S'+String(rows.length+1).padStart(2,'0'),title,duration,cast,scenes,start,end,boundary,segments})}
add('高楼与抵达',8,['黄征','队长'],['五十层写字楼外观'],'警队抵达南侧街道。','黄征抵达南入口，队长仍后两米，尚未进楼。','楼外到楼内在片段边界换场；不得把楼外末帧当楼内已经发生。',[
seg(1,0,'0–4',{1:'黄征与队长及四名无独立面部辨识需求的警员向北侧入口行进，黄征在前，队长后两米。',2:'黄征 and 队长 approach the entrance to the north with four anonymous officers; 黄征 leads and 队长 stays two metres behind.',3:'远处建立全景，核心五十层塔楼从地面入口至顶部完整可见，人物全身不超过画高8%。',4:'A distant establishing wide shot includes the complete fifty-storey tower from entrance to roof, full figures below eight percent of frame height.',9:'队伍仍在楼前广场朝入口靠近。',10:'The team is still approaching across the entrance forecourt.'}),
seg(1,0,'4–8',{1:'队伍继续向入口靠近，到门槛外停止在准备进入的状态，不重复起步。',2:'The team continues to the entrance and reaches the threshold in readiness to enter, without restarting the walk.',3:'切南入口外侧全景，完整门框与队伍可见，人物占画高30%，机位在东侧，不用仰角贴脸。',4:'Cut to an eastern full view outside the entrance, with the whole doorway and team visible, figures thirty percent of frame height.',9:'黄征在门外，队长后方，下一段从跨门槛接起。',10:'黄征 ends outside the door with 队长 behind; the next clip starts with crossing the threshold.'})]);
add('进楼与压缩退路',12,['黄征','队长'],['写字楼内部通道'],'黄征门外准备进入。','对方退向北端楼梯，警队继续推进，留守者控制入口。','在追击通向楼梯的动作结果处结束，下段明确省略到更高层，不假装连续跑完五十层。',[
seg(1,1,'0–4'),seg(1,2,'4–7'),seg(2,0,'7–12')]);
add('楼层推进与最后出口',12,['黄征','队长','贩毒头目'],['写字楼楼梯间'],'从下层追击明确省略到更高楼层。','头目到天台北侧机组；黄征与队长抵西南出口门内。','时间省略通过机位与楼层变化明确；段尾停在门内，室内外切换留给下一片段。',[
seg(2,1,'0–4'),
seg(2,1,'4–7',{1:'黄征和队长沿上行台阶继续追赶，头目抵达上平台；其他警员封住下方楼梯，位置不重置。',2:'黄征 and 队长 keep pursuing up the steps while the boss reaches the upper landing; other officers hold the lower stairs without resetting positions.',3:'保持东侧楼梯全景，随上行平移，人与阶梯完整可辨。',4:'Maintain the eastern full staircase view, tracking with the ascent and keeping people and stairs readable.',9:'头目仍领先，追击没有结束。',10:'The boss remains ahead and the pursuit continues.'}),
seg(2,2,'7–12',{9:'黄征在西南天台出口内侧，队长后方，头目已到北机组。',10:'黄征 ends inside the southwest roof exit, 队长 behind; the boss has reached northern HVAC cover.'})]);
add('天台空间建立',10,['黄征','队长','贩毒头目'],['五十层写字楼天台'],'黄征由西南出口入屋顶，头目北机组。','黄征在南缘北侧约2米，队长位于其西后方；目标在北机组。','完成入场与关系建立再切，不把走路截断为瞬移。多模态须重建相同地标和位置。',[
seg(3,0,'0–5',{1:'黄征从西南出口进入屋顶后面向北机组的贩毒头目，队长随后；出口距南缘约3米。',2:'黄征 emerges from the southwest exit, three metres north of the southern parapet, and faces the boss at the northern HVAC bank; 队长 follows.',3:'东侧略高的全景，完整屋顶边界与城市背景可见，人物全身约画高20%。',4:'A slightly elevated eastern wide view keeps the entire roof boundary and city context visible, full figures about twenty percent of height.'}),
seg(3,1,'5–10',{1:'黄征保持面朝北目标，沿南侧通路向东横移约4米以避开出口遮挡；队长从出口移至其西侧后方，二人均仍距南缘约2米。',2:'Facing the northern target, 黄征 sidesteps about four metres east along the southern route to clear the exit obstruction; 队长 follows to his western rear. Both remain about two metres north of the southern parapet.',5:'屋顶南北18米，移动发生在西南小范围，不跨越北侧机组。',6:'On the eighteen-metre-deep roof this is a short southwest movement, not a traverse from the northern machinery.',9:'黄征对北持枪，距南缘2米，队长在西侧后方且不挡南向退路。',10:'黄征 aims north two metres from the edge; 队长 remains to the western rear, clear of the southward fall path.'})]);
add('对峙逼近边缘',8,['黄征','队长','贩毒头目'],['五十层写字楼天台'],'黄征距南缘约2米，面向北机组。','黄征退到低围挡前半步，队长西南斜后、头目北方。','停止退步、关系稳定才分段；首帧承接可保持静态站位，多模态须复述站位，不能自动视为接帧。',[
seg(3,1,'0–4',{1:'头目从北机组侧举枪，黄征在正面压力下朝南后退约1.5米，仍面对北方；队长维持在其西南斜后，不进入退路。',2:'The boss raises his pistol from northern cover; under frontal pressure 黄征 backs about one and a half metres south while still facing north. 队长 remains southwest behind, clear of the retreat path.',9:'黄征距围挡半步，退步结束。',10:'黄征 ends half a step from the parapet; the backward steps are complete.'}),
seg(3,2,'4–8')]);
add('背叛的一枪',10,['黄征','队长','贩毒头目'],['五十层写字楼天台'],'三人延续上段站位。','黄征受击仍站立，尚未回头；队长枪口仍对他。','完整保留抬枪、单次开枪和受击结果；下一段只接反应，不重播枪击。',[
seg(4,0,'0–2'),seg(4,1,'2–5'),seg(4,2,'5–6'),seg(4,3,'6–10')]);
add('看清背叛者并越缘',12,['黄征','队长','贩毒头目'],['五十层写字楼天台'],'受击后仍站立，队长侧后方瞄准。','黄征已仰面离开南缘，未触地、无漩涡。','在越缘已完成、下坠开始的状态处分段，承接方向速度，不再从站立重演。',[
seg(5,0,'0–4'),seg(5,1,'4–8'),seg(5,2,'8–12')]);
add('坠落与意识中断',8,['黄征'],['五十层写字楼外观'],'已离开南缘、仰面下坠。','落地瞬间漩涡压来，黄征闭眼，黑场结束。','现代身体阶段在黑场结束，下一片段明确新场景新身体。不能用旧身体尾帧强行变形成新身体。',[
seg(6,0,'0–4'),seg(6,1,'4–6'),seg(6,2,'6–8',{7:'卷动声消退到黑场，最后开始传来下一场的马鼻息，不出现新身体。',8:'The swirling sound dies into black, with the first horse breath arriving as an audio bridge; the new body is not visible yet.'})]);
add('马上醒来',10,['华雄'],['三国开阔战场'],'黑场之后古代战场建立，华雄已在鞍上闭眼。','华雄已睁眼、持枪握缰，尚未识别对手。','新身份参考只使用华雄；不是继承现代尾帧的同姿态人物。醒来动作完成后才分段。',[
seg(6,3,'0–5',{1:'黑场后明确换场：华雄已在高头大马上，右手红缨枪左手缰绳；现代意识在独立古代身体醒转。',2:'After blackout, establish 华雄 already mounted, right hand holding a red-tasselled spear and left holding reins; consciousness returns within this distinct ancient body.',3:'切到东侧全景，完整人马与战场纵深可见，约画高35%，不做脸部变形。',4:'Cut to an eastern full view with complete rider and horse at thirty-five percent of height and deep battlefield space; do not use a facial morph.'}),
seg(6,4,'5–10')]);
add('确认陌生装备',12,['华雄'],['三国开阔战场'],'已经睁眼骑马面北。','装备确认完成，华雄看向北方来声，但尚未显出对手。','完整保留身份反应，不再次醒来；本段不提前使用后段对手图片。',[
seg(7,0,'0–4'),seg(7,1,'4–8'),
seg(7,1,'8–12',{1:'华雄由装备移开视线，抬头向北方；神情从疑惑变为警觉，马仍原地，右手枪左手缰不变。',2:'华雄 lifts his gaze away from the equipment toward the north, uncertainty becoming alertness. The horse remains still; spear stays in the right hand and reins in the left.',3:'机位保持东南侧中景，逐渐留出北向空间，不重复切换同一反应。',4:'Hold the southeast medium framing while allowing more looking room northward, without cutting repeatedly to the same reaction.',7:'北方开始有遥远马蹄，华雄不说话。',8:'Distant hoofbeats begin to the north; 华雄 does not speak.',9:'北向视线建立，下一段才揭示敌方。',10:'The northward eyeline is established; the opponent is revealed in the next clip.'})]);
add('喊名与冲锋开始',8,['华雄','潘凤'],['三国开阔战场'],'华雄北望；北方百米处对手即将被揭示。','潘凤已说完整句，向南冲锋，华雄原地握枪。','整句台词只在本段出现；段尾在冲锋进行中明确方向，不把声音截给下一视频。',[
seg(7,2,'0–4',{1:'北方约100米处，黑袍潘凤骑马持枪朝南面向华雄，纵马前先洪亮喊完整句“华雄匹夫，我潘凤来也！”，华雄循声确认自己被喊作华雄。',2:'About one hundred metres north, black-robed 潘凤 faces 华雄 on horseback with spear ready. Before accelerating he delivers the complete challenge; 华雄 realizes the name is directed at him.',7:'潘凤完整普通话大喊“华雄匹夫，我潘凤来也！”；华雄嘴闭合，不代配口型。',8:'潘凤, a booming male voice (S1), delivers the complete on-screen Mandarin line once: <d>[Mandarin Chinese] 华雄匹夫，我潘凤来也！</d> 华雄 stays silent with mouth closed.',9:'喊话已结束，对手准备加速，不截断台词。',10:'The complete call has ended; the opponent prepares to accelerate, with no unfinished dialogue.'}),
seg(8,0,'4–8',{1:'潘凤开始向南纵马持枪逼近，黑袍扬起，距离由百米开始缩短；华雄仍在南侧原地。',2:'潘凤 accelerates south with spear ready and black robe billowing, closing from the hundred-metre starting position while 华雄 remains to the south.',7:'只有蹄声、黑袍风声与旷野声，台词不重复。',8:'Only accelerating hoofbeats, robe flaps and open-country wind; do not repeat dialogue.',9:'对手冲锋已开始，剩余距离仍充足，华雄尚未挥枪。',10:'The charge is underway with a substantial gap remaining; 华雄 has not swung his spear.'})]);
add('握枪与未交锋的悬念',10,['华雄','潘凤'],['三国开阔战场'],'潘凤延续北向南冲锋，华雄仍在鞍上。','枪缰握紧，潘凤逼近但两骑未接触，第一招留到下集。','完整反应与冲锋在同段闭合，结尾不跨入交锋；不要求视频冻结。',[
seg(8,1,'0–5'),seg(8,2,'5–10')]);
await writeFile(new URL('authored-shots.json',dir),JSON.stringify(rows,null,2));
