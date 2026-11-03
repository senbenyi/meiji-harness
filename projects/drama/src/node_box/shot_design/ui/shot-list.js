import {element} from '../../../client/ui/panel-dom.js'

export function renderShotList(section,project,{editShot,editBeat,editDialogue}){
 const shots=[...project.shot_design.shots].sort((a,b)=>a.sequence-b.sequence)
 const names=new Map(Object.values(project.asset_library).flat().map(asset=>[asset.id,asset.name]))
 const duration=items=>items.reduce((total,shot)=>total+shot.beats.reduce((sum,beat)=>sum+beat.duration_seconds,0),0)
 const time=seconds=>seconds>=60?`${Math.floor(seconds/60)} 分 ${Number((seconds%60).toFixed(1))} 秒`:`${Number(seconds.toFixed(1))} 秒`
 const number=shot=>String(shot.sequence).padStart(2,'0')
 const button=(label,action)=>{const control=element('button',label);control.type='button';control.onclick=action;return control}
 const field=(parent,label,text)=>{if(text){const row=element('p','','production-shot-field'),name=element('strong',label+'：');row.append(name,document.createTextNode(text));parent.append(row)}}
 section.append(element('p',`${project.story_segments.segments.length} 个故事段 · ${shots.length} 个镜头 · 预计 ${time(duration(shots))}`,'production-shot-summary'))
 for(const segment of [...project.story_segments.segments].sort((a,b)=>a.sequence-b.sequence)){
  const items=shots.filter(shot=>shot.story_segment_id===segment.id),group=element('details','','production-shot-group'),summary=element('summary')
  group.open=true;summary.append(element('h4',`故事第 ${segment.sequence} 段 · ${segment.title}`),element('span',`${items.length} 个镜头 · ${time(duration(items))}`,'meta'));group.append(summary)
  if(!items.length)group.append(element('p','本段暂无镜头。','production-empty'))
  for(const shot of items){
   const card=element('article','','production-card production-shot-card'),scene=shot.scene_id?names.get(shot.scene_id):'未指定场景',head=element('div','','section-head')
   head.append(element('h4',`镜头 ${number(shot)} · ${scene}`),button('编辑镜头',()=>editShot(shot)));card.append(head)
   field(card,'场景',scene);field(card,'人物',shot.characters.map(row=>names.get(row.character_id)).join('、')||'无出场人物');field(card,'道具',shot.props.map(row=>names.get(row.prop_id)).join('、'));field(card,'预计时长',time(duration([shot])))
   shot.beats.forEach((beat,index)=>{
    const block=element('section','','production-shot-beat'),heading=element('div','','section-head');heading.append(element('h5',`节拍 ${index+1} · ${time(beat.duration_seconds)}`),button('编辑动作与声画',()=>editBeat(shot,beat)));block.append(heading)
    for(const [key,label]of [['action','动作'],['camera','摄影'],['scene_changes','场景变化'],['effects','特效']])field(block,label,beat[key])
    for(const line of beat.dialogues){
     const dialogue=element('div','','production-shot-dialogue');field(dialogue,names.get(line.speaker_id),line.text)
     const delivery=Object.entries({emotion:'情绪',volume:'音量',pace:'语速',breath:'气息'}).filter(([key])=>line.delivery[key]).map(([key,label])=>label+'：'+line.delivery[key]).join(' · ')
     field(dialogue,'表演',delivery);dialogue.append(button('编辑对白',()=>editDialogue(shot,line)));block.append(dialogue)
    }
    field(block,'环境声',beat.soundscape);field(block,'配乐',beat.music);card.append(block)
   })
   group.append(card)
  }
  section.append(group)
 }
}
