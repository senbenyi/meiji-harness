import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { withConfig } from '../src/config.js'
import { serverMedia } from '../src/media/server-media.js'
import { validateVideoPlan } from '../src/workflows/video-plan.js'
import { startVideoJob } from '../src/workflows/video-jobs.js'

const run=promisify(execFile)
test('server material preflight rejects missing assets and archives before submission; never crops or downloads',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'server-material-')))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const bin=join(root,'bin');await mkdir(bin)
  await writeFile(join(bin,'ssh'),'#!/usr/bin/env python3\nimport subprocess,sys\nsys.exit(subprocess.call(sys.argv[-1],shell=True))\n',{mode:0o700})
  const oldPath=process.env.PATH;process.env.PATH=`${bin}:${oldPath}`;t.after(()=>process.env.PATH=oldPath)
  const image=join(root,'reference.png')
  await run('ffmpeg',['-v','error','-f','lavfi','-i','color=s=64x64','-frames:v','1',image])
  const before=await readFile(image)
  const config={COMFYUI_SSH_HOST:'fixture',COMFYUI_SERVER_PYTHON:'python3',MINIMAX_H3_COMFYUI_OUTPUT_ROOT:root,COMFYUI_INPUT_ROOT:join(root,'input'),ARTIFACTS_ROOT:root,ELYSIUM_TOOLS_STATE_ROOT:join(root,'tasks')}
  await withConfig(config,async()=>{
    const shot={id:'a',duration:1,prompt:'prepared scene',image_role:'single-view',image_path:`ssh://fixture${image}`}
    const plan={duration:2,shots:[shot,{...shot,id:'b'}]}
    await validateVideoPlan(plan)
    const info=await serverMedia({operation:'check',path:image})
    assert.equal(info.media_info.width,64)
    assert.deepEqual(await readFile(image),before)
    for(const change of [s=>delete s.image_path,s=>s.image_path=`ssh://fixture${root}/missing.png`,s=>s.image_role='character-sheet',s=>s.image_crop={x:0,y:0,width:32,height:64}]){
      const invalid=structuredClone(plan);change(invalid.shots[1])
      await assert.rejects(startVideoJob(invalid),{code:'MODEL_INPUT_INVALID'})
    }
    assert.equal(await stat(join(root,'tasks/jobs')).catch(()=>null),null)
    assert.equal(await stat(join(root,'input')).catch(()=>null),null)
  })
})

test('server output validation rejects traversal, missing and corrupt files',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'server-output-')))
  t.after(()=>rm(root,{recursive:true,force:true}))
  await writeFile(join(root,'bad.mp4'),'not video')
  await withConfig({MINIMAX_H3_COMFYUI_OUTPUT_ROOT:root},async()=>{
    for(const filename of ['../escape.mp4','absent.mp4','bad.mp4']) await assert.rejects(serverMedia({operation:'output',descriptor:{filename,type:'output'}}))
  })
})
