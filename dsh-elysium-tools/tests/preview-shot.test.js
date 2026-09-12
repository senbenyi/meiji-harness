import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec=promisify(execFile)
const script=fileURLToPath(new URL('../scripts/preview-shot.mjs',import.meta.url))
const request={profile:'preview',mode:'t2va',prompt:'A fictional adult reads a letter.'}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'preview-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const input=join(root,'request.json'),receipt=join(root,'receipt.json'),state=join(root,'state')
 await writeFile(input,JSON.stringify(request));await mkdir(join(state,'jobs'),{recursive:true})
 const env={...process.env,COMFYUI_URL:'http://127.0.0.1:1',ELYSIUM_TOOLS_STATE_ROOT:state}
 return {root,input,receipt,state,env}
}
test('completed receipt reuses its job without starting another worker or making a network request',async t=>{
 const f=await fixture(t),id='a'.repeat(32),directory=join(f.state,'jobs',id)
 await mkdir(directory);await writeFile(join(directory,'status.json'),JSON.stringify({job_id:id,capability:'workflow-video',backend:'comfyui',status:'succeeded',result:{path:'https://example.invalid/video.mp4'}}))
 await writeFile(f.receipt,JSON.stringify({request,job_id:id}))
 await exec(process.execPath,[script,f.input,f.receipt],{env:f.env})
 const result=JSON.parse(await readFile(f.receipt,'utf8'))
 assert.equal(result.job_id,id);assert.equal(result.result.status,'succeeded')
 assert.deepEqual(await readdir(join(f.state,'jobs')),[id]);assert.deepEqual(await readdir(directory),['status.json'])
})
test('receipt cannot be reused for a different shot',async t=>{
 const f=await fixture(t);const original={request:{...request,prompt:'Different shot'},job_id:'b'.repeat(32)}
 await writeFile(f.receipt,JSON.stringify(original))
 await assert.rejects(exec(process.execPath,[script,f.input,f.receipt],{env:f.env}),/Receipt belongs to another shot/)
 assert.deepEqual(JSON.parse(await readFile(f.receipt,'utf8')),original);assert.deepEqual(await readdir(join(f.state,'jobs')),[])
})
test('invalid request fails before allocating a job or receipt',async t=>{
 const f=await fixture(t);await writeFile(f.input,JSON.stringify({...request,width:384}))
 await assert.rejects(exec(process.execPath,[script,f.input,f.receipt],{env:f.env}),/未支持参数/)
 assert.deepEqual(await readdir(join(f.state,'jobs')),[])
 await assert.rejects(readFile(f.receipt),{code:'ENOENT'})
})
