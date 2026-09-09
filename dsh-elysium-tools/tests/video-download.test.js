import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { verifiedDownload } from '../src/workflows/video-artifacts.js'

test('validated cache saves transfers but changed source, local corruption and invalid media cannot pass', async t=>{
  const root=await mkdtemp(join(tmpdir(),'verified-download-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const source=join(root,'source.mp4'), output=join(root,'result.mp4')
  await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','color=s=64x64:r=30:d=1','-f','lavfi','-i','sine=duration=1','-c:v','libx264','-c:a','aac',source])
  let downloads=0, corrupt=false
  const client={url:new URL('http://example.invalid/'),download:async(_,path)=>{downloads++;if(corrupt)await writeFile(path,'bad video');else await copyFile(source,path)}}
  const settings={outputWidth:64,outputHeight:64,outputFps:30}, descriptor={filename:'a.mp4',type:'output'}
  const read=(file=descriptor)=>verifiedDownload(client,file,output,1,settings,join(root,'probe.json'))
  await read();await read();assert.equal(downloads,1)
  await writeFile(output,'corrupted locally');await read();assert.equal(downloads,2)
  await read({...descriptor,filename:'b.mp4'});assert.equal(downloads,3)
  corrupt=true
  await assert.rejects(read({...descriptor,filename:'broken.mp4'}))
  assert.equal(downloads,4)
})
