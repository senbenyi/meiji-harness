import {readdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const dir=dirname(fileURLToPath(import.meta.url)),read=async p=>{try{return JSON.parse(await readFile(resolve(dir,p),'utf8'))}catch{return null}},rounds=[],jobs=[]
const dimensions=['story_quality','continuity','coverage','dialogue','no_readaptation','shootability']
for(const key of ['moon','wusong','complex'])for(let round=1;round<=3;round++){
 const rows={}
 for(const v of ['A','B']){
  const base=`results/${key}/round-${round}/${v}`,result=await read(base+'/result.json'),oc=await read(base+'/outline/call.json'),sc=await read(base+'/shot/call.json'),outline=await read(base+'/outline/parsed.json')
  rows[v]={...result,outlineCall:oc,shotCall:sc,segmentCount:outline?.segments.length,outlineSeconds:outline?.segments.reduce((n,s)=>n+s.duration_seconds,0)}
  if(result)jobs.push(rows[v])
 }
 const judge=await read(`results/${key}/round-${round}/judge/parsed.json`),map=await read(`results/${key}/round-${round}/judge/blind-map.json`)
 const valid=judge&&map&&['X','Y'].every(side=>dimensions.every(d=>Number.isInteger(judge[side]?.scores?.[d])&&judge[side].scores[d]>=0&&judge[side].scores[d]<=4))
 if(judge&&valid){for(const side of ['X','Y'])rows[map[side]].judge=judge[side]}
 rounds.push({key,round,versions:rows,judgeValid:!!valid,preferred:valid?(judge.preferred==='tie'?'tie':map[judge.preferred]):null,judgeReason:judge?.reason})
}
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null
const summary={versions:{},paired:{A:0,B:0,tie:0,unjudged:0}}
for(const v of ['A','B']){
 const rows=jobs.filter(j=>j.version===v),done=rows.filter(j=>j.status==='completed')
 summary.versions[v]={runs:rows.length,completed:done.length,failed:rows.filter(j=>j.status==='failed').length,
  meanSegments:avg(done.map(x=>x.segmentCount)),meanShots:avg(done.map(x=>x.metrics.shotCount)),meanReferenceCoverage:avg(done.map(x=>x.metrics.referenceCoverage).filter(x=>x!==null)),meanQuotedTextRecallHeuristic:avg(done.map(x=>x.metrics.quotedTextRecallHeuristic).filter(x=>x!==null)),referenceErrors:done.flatMap(x=>x.metrics.issues).length,unreferencedAnchors:done.reduce((n,x)=>n+x.metrics.unreferencedAnchorIds.length,0),missingSegments:done.reduce((n,x)=>n+x.metrics.missingSegmentIds.length,0),
  meanOutlineElapsedSeconds:avg(rows.map(x=>x.outlineCall?.elapsedMs/1000).filter(Number.isFinite)),meanShotElapsedSeconds:avg(rows.map(x=>x.shotCall?.elapsedMs/1000).filter(Number.isFinite)),meanShotInputChars:avg(rows.map(x=>x.shotCall?.inputChars).filter(Number.isFinite)),meanShotOutputChars:avg(rows.map(x=>x.shotCall?.outputChars).filter(Number.isFinite)),scoresRawUnverified:Object.fromEntries(dimensions.map(d=>[d,avg(rounds.map(x=>x.versions[v].judge?.scores[d]).filter(Number.isFinite))])),judgeIssuesBySeverityRawUnverified:Object.fromEntries(['minor','major','critical'].map(s=>[s,rounds.flatMap(x=>x.versions[v].judge?.issues||[]).filter(i=>i.severity===s).length]))}
}
for(const row of rounds)summary.paired[row.preferred||'unjudged']++
await writeFile(resolve(dir,'analysis.json'),JSON.stringify({summary,rounds},null,2)+'\n')
console.log(JSON.stringify(summary,null,2))
