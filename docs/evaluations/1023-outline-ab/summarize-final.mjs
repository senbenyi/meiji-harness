import {readFile,writeFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const dir=dirname(fileURLToPath(import.meta.url)),load=async p=>{try{return JSON.parse(await readFile(resolve(dir,p),'utf8'))}catch{return null}}
const dims=['expression_inner_state','tension_rhythm','background_atmosphere','blocking_spatial','action_physics','effects_appropriateness','sensory_specificity','fidelity_sound'],rows=[]
for(const key of ['moon','wusong','complex'])for(let round=1;round<=3;round++){
 const row={key,round,versions:{}}
 for(const v of ['A','B']){
  const p=`results/${key}/round-${round}/${v}/final-v2`,upstream=await load(`results/${key}/round-${round}/${v}/result.json`),selection=await load(p+'/selection.json'),output=await load(p+'/parsed.json'),failure=await load(p+'/failure.json'),call=await load(p+'/call.json')
  row.versions[v]={upstream:upstream?.status??'pending',status:output?'completed':failure?.message?.includes('上游镜头未通过契约')?'blocked_upstream':failure?'failed':'pending',selectionProblems:selection?.problems??[],topics:selection?.selected.map(x=>({id:x.topic.id,shot_id:x.shot.id,duration_seconds:x.clip.duration_seconds}))??[],promptCount:output?.items.length??0,failure,call}
 }
 const p=`results/${key}/round-${round}/final-v2-judge`,j=await load(p+'/parsed.json'),map=await load(p+'/blind-map.json')
 const valid=j&&map&&['X','Y'].every(s=>dims.every(d=>Number.isInteger(j[s]?.scores?.[d])&&j[s].scores[d]>=0&&j[s].scores[d]<=4))
 if(valid){row.rawJudge={preferred:j.preferred==='tie'?'tie':map[j.preferred],reason:j.reason,topics:j.topics?.map(x=>({...x,preferred:x.preferred==='tie'?'tie':map[x.preferred]})),scores:Object.fromEntries(['X','Y'].map(s=>[map[s],j[s].scores])),issues:Object.fromEntries(['X','Y'].map(s=>[map[s],j[s].issues]))}}
 row.manualAudit=await load(p+'/manual-audit.json')
 rows.push(row)
}
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,summary={rawScoresAreUnverified:true,versions:{},rawPairedPreferences:{A:0,B:0,tie:0,unjudged:0}}
for(const v of ['A','B']){
 const r=rows.map(x=>x.versions[v]);summary.versions[v]={completed:r.filter(x=>x.status==='completed').length,failed:r.filter(x=>x.status==='failed').length,blockedUpstream:r.filter(x=>x.status==='blocked_upstream').length,pending:r.filter(x=>x.status==='pending').length,promptCount:r.reduce((n,x)=>n+x.promptCount,0),missingTopicCount:r.reduce((n,x)=>n+x.selectionProblems.length,0),scoresRawUnverified:Object.fromEntries(dims.map(d=>[d,avg(rows.map(x=>x.rawJudge?.scores[v][d]).filter(Number.isFinite))]))}
}
for(const r of rows)summary.rawPairedPreferences[r.rawJudge?.preferred||'unjudged']++
await writeFile(resolve(dir,'final-v2-analysis.json'),JSON.stringify({summary,rows},null,2)+'\n');console.log(JSON.stringify(summary,null,2))
