import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {projectStore} from '../../server/data/projects.js';
const store=projectStore(process.cwd()+'/.dsh'),id='7a8b0266-69c2-4122-9ec8-eeb7d285a0c9',dir=new URL('./',import.meta.url);
const p=await store.read(id);assert.ok(!p.activity&&!p.activeOperation);await writeFile(new URL('before.json',dir),JSON.stringify(p,null,2));
const episodes=structuredClone(p.episodes),e=episodes.find(x=>x.id==='15442eeb-3592-4cab-a4f5-9ff424465b89'),s=e.shots.items.find(x=>x.id==='S03');assert.equal(s.duration,12);
const marker='追击的中间楼层省略：离开下层通道后，画面直接切到更高处的楼梯平台，空窗外已能俯见邻近低楼屋顶，未封砖墙与窗洞成为新的环境参照；随后再次省略剩余攀登，来到无继续上行梯段、直通露天天台的末端平台。不显示楼层数字，不表现人物在同一时刻瞬移。黄征与队长在本段结束时仍停在天台门槛内，下一段才跨出。';
e.outline=e.outline.replace('时间省略保留向上追击的方向和结果，不表现为十八秒步行穿过多层。','追击省略中间楼层，经过一段未展示的攀登后已到较高处，再经过省略来到通往天台的末端平台；保留向上追击的方向和结果，不表现为十八秒连续跑完多层。');
s.text=s.text.replace('起始状态：从下层追击明确省略到更高楼层。','起始状态：'+marker).replace('时间省略通过机位与楼层变化明确','两次硬切分别以窗外低楼屋顶的俯视视线、无继续上行楼梯的露天天台出口确认楼层与时间变化');
s.secondsText=`S03 / 12s

### 0–4s
- 动作：省略离开下层通道后的中间攀登。新画面中，贩毒头目已在较高处的上行梯段前端，黄征随后，队长再后约两米；三人向上追逃，两名普通警员在下方折返平台封住退路。
- 镜头：从上一镜下层通道硬切至楼梯间东侧高处、朝西看的全景，不使用连续跟拍或匹配同一步伐来假装即时抵达。先在同一宽画面中保留平台北侧空窗洞：窗外可以向下看见邻近低楼屋顶，表明已经升高；粗砖墙缺口与完整窗洞区别于上一镜通道。人物全身约占画高30%–35%，不插入楼层数字特写。
- 空间：三人位于靠东梯段，面北上行；机位朝西，北在画面右、南在左，看见人物右侧身体。窗外高度变化、楼梯结构和三人已在高处的位置共同表明时间省略，不仅依靠“时间跳跃”的文字声明。
- 声音：换景后下层枪声已经远而闷，近处急促脚步带混凝土回响；声音距离变化辅助省略，不重复进入大楼的枪战。
- 交接：头目先到北侧折返平台，黄征随后、队长仍在后，下方警员守住通路。

### 4–7s
- 动作：在已建立的同一高处楼梯空间内连续追赶。头目绕过平台扶手转上靠西的下一跑梯段，黄征和队长依次跟上，保持前后顺序。转向是实际楼梯折返所需，不为看清正脸而转身。
- 镜头：保持东侧朝西的全景，轻微向上调整取景跟随攀登，完整保留平台转折和下一跑梯段，不推近。此段不再宣称发生新的时间跳跃。
- 空间：靠东梯段向北上行后，在北平台转向靠西梯段向南上行；画面运动由向右转为向左，经过可见的平台转弯。下方留守警员因取景上移逐渐出画，仍在下方原位，不能出现在三人前方。
- 声音：脚步、衣料和扶手旁的回声持续，下层枪声更远；没有新增对白。
- 交接：三人仍在向更高处追逃，头目领先；从这里到顶层还有未展示的攀登，下一硬切省略它。

### 7–9s
- 动作：再次省略剩余攀登，硬切后的三人已经先后到达最终平台。头目推开北侧未完工铁门，侧身冲出，黄征抵近门内，队长停在他后方。
- 镜头：硬切至末端平台东侧、朝西略偏北的平视全景。该平台没有继续向上的梯段，北门外能直接看见露天天空和天台混凝土地面，明确区别于刚才封闭的折返楼梯；这不是同一楼层换角度。保留全身、门槛、下行楼梯和门外可辨细节，不用过曝遮住环境依据。
- 空间：门在北侧、画面右前方；人物向北面门，机位见其右侧及少量后侧。旧平台的留守警员留在省略掉的下方楼层，不瞬移至顶层。
- 声音：铁门摩擦与门轴响在近处，门开后室外风声明显进入；楼下枪声很远。
- 交接：头目已经出门，黄征双脚仍在门槛内，队长在他身后约两米，门保持打开。

### 9–12s
- 动作：黄征在门槛内警戒，枪口与视线朝北侧天台，调整重心准备突入但不跨门；队长在他侧后方掩护，也不跨门。头目继续向天台北侧未完工设备基座退去，离开门洞可见范围；不另切到室外展示。
- 镜头：保持门内东侧全景，人物全身与门槛关系清楚，不跟出门，不增加正面特写。
- 空间：黄征与队长始终在天台西南出口内，均朝北；门外空地是下一镜的行动区。头目在北方画外，后方下层通路仍由警员控制，不要求画面同时看见不在此层的警员。
- 声音：头目远去的脚步淡出，风声从北侧开门处传入；黄征和队长脚步停下后只剩衣料、呼吸与风声，没有虚构台词。
- 交接：头目抵北侧设备基座掩体；黄征与队长仍在西南出口门槛内准备出门，下一镜才跨门进入天台。`;
if(e.shots.rawText)e.shots.rawText=e.shots.items.map(x=>`## ${x.id} / ${x.duration}s\n${x.text}`).join('\n\n');
// Direct editorial revision is not a model review result.
s.secondsReviewText='待重新自检：已人工定向修订两次时间省略的视觉依据、楼梯折返方位及门内结束状态。';
e.feedback['seconds:S03'].check={passed:null,failures:[]};
const saved=await store.save(id,{episodes},{expectedRevision:p.revision});
assert.deepEqual(saved.episodes[0].characters,p.episodes[0].characters);assert.deepEqual(saved.episodes[0].scenes,p.episodes[0].scenes);assert.deepEqual(saved.episodes[0].shots.items.filter(x=>x.id!=='S03'),p.episodes[0].shots.items.filter(x=>x.id!=='S03'));
await writeFile(new URL('after.json',dir),JSON.stringify(saved,null,2));console.log(JSON.stringify({revision:saved.revision,shot:'S03',duration:12,review:'pending'}));
