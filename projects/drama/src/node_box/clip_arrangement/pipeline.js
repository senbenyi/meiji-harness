import {uid} from '../../production/execution_support.js'
export function arrangeClips(project){
  const beats=[...project.shot_design.shots].sort((a,b)=>a.sequence-b.sequence).flatMap(shot=>shot.beats.map(beat=>({shot,beat})))
  if(!beats.length)throw new TypeError('没有可分片节拍')
  const paths=Array(beats.length+1).fill(null);paths[0]=[]
  for(let end=1;end<=beats.length;end++){let seconds=0;for(let start=end-1;start>=0;start--){seconds+=beats[start].beat.duration_seconds;if(Math.ceil(seconds)>15)break;if(Math.ceil(seconds)>=4&&paths[start]){const group=beats.slice(start,end),images=new Set(group.flatMap(x=>x.shot.reference_images.map(r=>r.image_id)));if(images.size>9)continue;paths[end]=[...paths[start],group];break}}}
  if(!paths.at(-1))throw new TypeError('节拍无法无遗漏地组合成4～15秒分片，请调整节拍或镜头参考数量')
  return paths.at(-1).map((group,index)=>{const sources=[];for(const {shot,beat}of group){let row=sources.find(r=>r.shot_id===shot.id);if(!row){row={shot_id:shot.id,beat_ids:[]};sources.push(row)}row.beat_ids.push(beat.id)}
    const old=project.clip_arrangement.clips.find(c=>JSON.stringify(c.sources)===JSON.stringify(sources))
    return {id:old?.id||uid('clip'),sequence:index+1,duration_seconds:Math.ceil(group.reduce((s,r)=>s+r.beat.duration_seconds,0)),sources,mode:group.some(r=>r.shot.reference_images.length)?'reference':'text',first_image_id:null,last_image_id:null}
  })
}
