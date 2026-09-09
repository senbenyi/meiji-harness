import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readJson, saveJson } from '../src/jobs/json.js'
import { getJob } from '../src/jobs/query.js'

test('SIGTERM stops local waiting, retains remote identity and records a recoverable failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'worker-stop-')), id = 'e'.repeat(32), directory = join(root,'jobs',id)
  t.after(()=>rm(root,{recursive:true,force:true}))
  const mutations=[]
  const server=createServer((req,res)=>{
    if(req.method!=='GET') mutations.push(req.url)
    res.end(JSON.stringify(req.url==='/queue'?{queue_running:[[0,'original']],queue_pending:[]}:{}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
  const url=`http://127.0.0.1:${server.address().port}/`, plan={duration:1,prompts:['original']}
  await saveJson(join(directory,'input/request.json'),plan)
  await saveJson(join(directory,'comfyui-workflow.json'),{plan,server_url:url,graph:{},workflowName:'workflow_generate_video'})
  await saveJson(join(directory,'comfyui-submission.json'),{server_url:url,prompt_id:'original'})
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/workflows/video-worker.js',import.meta.url)),id],{
    env:{...process.env,ELYSIUM_TOOLS_STATE_ROOT:root,ARTIFACTS_ROOT:root,MINIMAX_H3_COMFYUI_URL:url,MINIMAX_H3_COMFYUI_PUBLIC_URL:url},stdio:'ignore'})
  const closed=new Promise(resolve=>child.once('exit',resolve))
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL')})
  for(let i=0;i<100;i++){
    if((await readJson(join(directory,'status.json')))?.stage==='execute') break
    await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert.equal((await readJson(join(directory,'status.json'))).stage,'execute')
  child.kill('SIGTERM'); await closed
  const status=await readJson(join(directory,'status.json'))
  assert.equal(status.status,'failed')
  assert.equal(status.error_code,'LOCAL_WORKER_STOPPED')
  assert.equal(status.comfyui_prompt_id,'original')
  assert.match(status.error,/远端任务未取消/)
  assert.deepEqual(mutations,[])
  assert.equal((await readJson(join(directory,'comfyui-submission.json'))).prompt_id,'original')
})

test('stale running record is reported as stopped without rewriting remote history', async t=>{
  const root=await mkdtemp(join(tmpdir(),'worker-stale-')), id='f'.repeat(32), path=join(root,'jobs',id,'status.json')
  const previous=process.env.ELYSIUM_TOOLS_STATE_ROOT
  process.env.ELYSIUM_TOOLS_STATE_ROOT=root
  t.after(async()=>{if(previous===undefined)delete process.env.ELYSIUM_TOOLS_STATE_ROOT;else process.env.ELYSIUM_TOOLS_STATE_ROOT=previous;await rm(root,{recursive:true,force:true})})
  await saveJson(path,{job_id:id,backend:'comfyui',status:'running',stage:'inspect-output',comfyui_prompt_id:'original',remote_status:'succeeded'})
  const before=await readFile(path,'utf8'), status=await getJob(id)
  assert.equal(status.error_code,'WORKER_NOT_RUNNING')
  assert.equal(status.remote_status,'succeeded')
  assert.equal(status.comfyui_prompt_id,'original')
  assert.equal(await readFile(path,'utf8'),before)
})
