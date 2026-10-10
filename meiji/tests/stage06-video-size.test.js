import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { normalizeVideo } from '../server/media/normalize-video.js';
for (const size of ['1344x768','768x1344']) test(`网关视频本地导出${size}并保留音轨`,async()=>{
 const temp=await mkdtemp(join(tmpdir(),'meiji-pixels-test-'));
 try{
  const input=join(temp,'input.mp4'),output=join(temp,'output.mp4');
  execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=red:s=64x36:d=0.15','-f','lavfi','-i','sine=duration=0.15','-c:v','libx264','-c:a','aac','-shortest',input]);
  const original=await readFile(input),bytes=await normalizeVideo(original,size,new AbortController().signal);
  await writeFile(output,bytes);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',output]));
  const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(`${video.width}x${video.height}`,size);
  assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
  assert.deepEqual(await normalizeVideo(bytes,size,new AbortController().signal),bytes);
  const controller=new AbortController();controller.abort();await assert.rejects(normalizeVideo(original,size,controller.signal),/abort/i);
  assert.deepEqual(await readFile(input),original);
 }finally{await rm(temp,{recursive:true,force:true});}
});
