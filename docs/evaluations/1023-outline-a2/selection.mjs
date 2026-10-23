const topics={moon:[{id:'crowd',label:'人群压力与安全制止',terms:['烟','人群','熄','麦思敦']},{id:'farewell',label:'离别与被拒同行的微表情',terms:['麦思敦','同行','泪','巴比堪']},{id:'launch',label:'发射冲击、环境与特效',terms:['炮','火','冲击','发射']}],wusong:[{id:'medicine',label:'端药犹疑与内心冲突',terms:['潘金莲','碗','药','手']},{id:'brothers',label:'兄弟之间的克制与张力',terms:['武大郎','武松','我还活着','拳']},{id:'fight',label:'染坊动作与空间互动',terms:['染','竹竿','西门庆','刀']}],complex:[{id:'sisters',label:'姐妹信任变化与表情',terms:['江禾','沈岚','怕','相机']},{id:'rescue',label:'救援站位、持续动作与水压',terms:['压轮','沈岚','陈姨','门']},{id:'keys',label:'钥匙交接与物件连续性',terms:['红钥匙','许衡','沈岚','交']}]}
export function select(shots,key,outline){
 const used=new Set(),selected=[],problems=[]
 for(const topic of topics[key]){
  const candidates=[]
  for(const [si,s]of shots.shots.entries())for(const [bi,b]of s.beats.entries()){
   if(b.duration_seconds<4||b.duration_seconds>15||used.has(`${si}:${bi}`))continue
   const action=b.action+' '+b.audio,full=action+' '+s.title+' '+b.effects
   let eligible=false,bonus=0
   if(key==='moon'&&topic.id==='crowd')eligible=/烟|雪茄/.test(action)&&/夺|抢|收缴|熄灭/.test(b.action)
   if(key==='moon'&&topic.id==='farewell')eligible=/同行|留在地球|年事已高|年老/.test(action)&&/麦思敦/.test(JSON.stringify(s.characters))
   if(key==='moon'&&topic.id==='launch')eligible=/炮/.test(full)&&/烈火|火焰|轰然发射|轰然放射|冲出炮口/.test(b.action+' '+b.effects)
   if(key==='wusong'&&topic.id==='medicine'){
    const segment=outline.segments.find(x=>x.id===s.story_segment_id)
    eligible=/药粉|药液|治伤|端药|喂药|手抖|握着碗|握住碗|端起又放下|欲言又止/.test(action)&&/药|碗/.test(action)&&!/茶碗|打翻茶|记忆原话|大郎，该吃药了/.test(action)&&/和离|药粉|治伤的药/.test(segment?.body||'')
    if(/手抖|犹疑|犹豫|迟疑|放下|不放|欲言又止/.test(action))bonus+=4
   }
   if(key==='wusong'&&topic.id==='brothers')eligible=/我还活着/.test(action)
   if(key==='wusong'&&topic.id==='fight')eligible=/刀|竹竿/.test(action)&&/挑|横扫|格挡|挡开|抵挡|挡住|挡过|刺|缠|撞|压刀|压住|劈|反划|踹/.test(b.action)&&/染坊|染缸|晾布/.test(JSON.stringify(s.scene)+' '+full)
   if(key==='complex'&&topic.id==='sisters')eligible=/只剩你签字|替我承担|都写进去/.test(action)
   if(key==='complex'&&topic.id==='rescue')eligible=/泄压轮|压轮/.test(action)&&/压住|按压|按住|松开|离开/.test(action)&&/门|陈姨/.test(action)
   if(key==='complex'&&topic.id==='keys')eligible=/红钥匙/.test(full)&&/许衡/.test(action)&&/交给|交还|递给|接过|接回/.test(b.action)
   if(!eligible)continue
   const score=topic.terms.reduce((n,t)=>n+(full.includes(t)?1:0),0)+bonus
   candidates.push({si,bi,s,b,score})
  }
  candidates.sort((a,b)=>b.score-a.score||a.si-b.si||a.bi-b.bi)
  const best=candidates[0]
  if(!best||best.score<2){problems.push({topic:topic.id,reason:'无足够相关且时长合法的完整节拍'});continue}
  used.add(`${best.si}:${best.bi}`)
  const {beats,...common}=best.s
  selected.push({topic,clip:{id:`eval_${topic.id}`,mode:'文生',duration_seconds:best.b.duration_seconds,sources:[{shot_id:best.s.id,beat_start:best.bi,beat_end:best.bi}]},shot:{...common,beats:[best.b]},prior_beats_context:beats.slice(0,best.bi),selectionScore:best.score})
 }
 return{selected,problems}
}
