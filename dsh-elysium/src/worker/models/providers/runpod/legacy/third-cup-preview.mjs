// Local production runner: uses existing plugin jobs and ComfyUI APIs; never SSH.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { ComfyClient } from '../../../protocols/comfyui/client.js'
import { readJson, saveJson } from '../../../../../database/json.js'
import { withLaunchLock } from '../../../../tasks/jobs/lock.js'
const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
const directory=join(root,'docs/implement/third-cup-preview')
const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'))
const limit=Number(process.argv[2] || 10)
if (!Number.isInteger(limit)||limit<1||limit>120) throw Error('Limit must be 1..120')
const url=process.env.COMFYUI_URL
if (!url) throw Error('COMFYUI_URL is required')
const client=new ComfyClient(url)
const exec=promisify(execFile)
await mkdir(join(directory,'runner.lock'),{recursive:true})
await withLaunchLock(join(directory,'runner.lock'),async()=>{
 const started=Date.now()
 const anchors=await readJson(join(directory,'anchors.json')) || {}
 for(const shot of manifest.shots.slice(0,limit)) {
  const base=join(directory,shot.id)
  let request=await readJson(`${base}.request.json`)
  if(!request) {
   if(shot.mode==='i2va'&&!anchors[shot.role]) throw Error(`Missing reference ${shot.role}`)
   request={profile:'preview',mode:shot.mode,prompt:shot.prompt,...(shot.mode==='i2va'?{first_frame:anchors[shot.role].url}:{})}
   await saveJson(`${base}.request.json`,request)
  }
  let receipt=await readJson(`${base}.receipt.json`)
  // At most three total invocations per shot across restarts, unless an operator reviews it.
  const attempts=await readJson(`${base}.attempts.json`) || []
  while(receipt?.result?.status!=='succeeded') {
   if(attempts.length>=3) throw Error(`${shot.id}: retry budget exhausted; inspect original receipt`)
   attempts.push({started_at:new Date().toISOString()});await saveJson(`${base}.attempts.json`,attempts)
   console.log(`${shot.id} ${shot.role}: attempt ${attempts.length}`)
   try {
    const result=await exec(process.execPath,[join(root,'dsh-elysium/scripts/preview-shot.mjs'),`${base}.request.json`,`${base}.receipt.json`],{cwd:root,env:process.env,maxBuffer:8*1024*1024})
    await writeFile(`${base}.log`,result.stdout+result.stderr)
   } catch(error) {
    await writeFile(`${base}.log`,`${error.stdout||''}\n${error.stderr||error.message}`)
    // A missing receipt must never be treated as permission to resubmit.
    receipt=await readJson(`${base}.receipt.json`)
    if(!receipt)throw Error(`${shot.id}: no durable receipt; inspect before retry`)
   }
   receipt=await readJson(`${base}.receipt.json`)
   attempts.at(-1).ended_at=new Date().toISOString();attempts.at(-1).status=receipt?.result?.status||'interrupted';await saveJson(`${base}.attempts.json`,attempts)
  }
  const history=(await client.request(`history/${receipt.result.comfyui_prompt_id}`))[receipt.result.comfyui_prompt_id]
  if(!history?.status?.completed)throw Error(`${shot.id}: missing successful history`)
  const cached=history.status.messages.filter(([type])=>type==='execution_cached').flatMap(([,data])=>data.nodes||[])
  if(cached.includes('n105_14'))throw Error(`${shot.id}: sampler was cached`)
  await saveJson(`${base}.history.json`,history)
  if(shot.number<=4 && !anchors[shot.role]) {
   const media=new URL(receipt.result.comfyui_view_url)
   const file=`${media.searchParams.get('subfolder')}/${media.searchParams.get('filename')} [output]`
   const graph={
    '1':{class_type:'LoadVideo',inputs:{file}},
    '2':{class_type:'GetVideoComponents',inputs:{video:['1',0]}},
    '3':{class_type:'ImageFromBatch',inputs:{image:['2',0],batch_index:36,length:1}},
    '4':{class_type:'SaveImage',inputs:{images:['3',0],filename_prefix:`third-cup-preview/references/${shot.role}`}}
   }
   await saveJson(`${base}.reference.api.json`,graph)
   const id=createHash('sha256').update(`third-cup:${shot.id}:reference`).digest('hex').slice(0,32)
   await client.validate(graph)
   const prompt=await client.submit(graph,id,`${base}.reference.submission.json`)
   const result=await client.wait(prompt,180000)
   const descriptor=result.outputs['4'].images[0]
   anchors[shot.role]={url:client.viewUrl(descriptor),prompt_id:prompt,source_job_id:receipt.job_id}
   await saveJson(join(directory,'anchors.json'),anchors)
  }
  const priorProgress=await readJson(join(directory,'progress.json'))
  await saveJson(join(directory,'progress.json'),{completed:Math.max(priorProgress?.completed||0,shot.number),checked_shot:shot.number,total:120,last_job_id:receipt.job_id,updated_at:new Date().toISOString(),run_elapsed_ms:Date.now()-started})
  console.log(`${shot.id} done ${receipt.job_id} server_ms=${receipt.result.server_execution_ms}`)
 }
})
