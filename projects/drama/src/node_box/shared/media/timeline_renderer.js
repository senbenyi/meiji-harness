import {subtitleTrack,clipSubtitles} from './subtitles.js'
import {probeFile,command,withTemporary} from '../../../shared/media/media.js'
import {join} from 'node:path'
import {writeFile,readFile} from 'node:fs/promises'

export async function renderTimeline(service,ctx,project,timeline,{start=0,end}={}){
  const id=project.basic_info.id,settings=project.delivery.settings,duration=Math.max(...timeline.clips.map(c=>c.position_seconds+c.out_seconds-c.in_seconds));end??=duration
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration+0.05)throw new TypeError('导出范围越界')
  return withTemporary(async root=>{
    const pieces=[],inputs=[],filters=[];let cursor=0,index=0
    for(const edit of [...timeline.clips].sort((a,b)=>a.position_seconds-b.position_seconds)){
      if(edit.position_seconds<cursor-0.001)throw new TypeError('时间线片段不能重叠')
      const gap=edit.position_seconds-cursor;if(gap>0.001){const gapFile=join(root,`gap${index}.mp4`);await command('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=black:s=${settings.width}x${settings.height}:r=${settings.fps}`,'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t',String(gap),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',gapFile],{signal:ctx.signal});pieces.push(gapFile)}
      const take=project.videos.find(v=>v.id===edit.take_id);if(!take)throw new TypeError('素材缺失')
      const source=join(root,`input${index}.mp4`);await writeFile(source,await service.projects.documents.readArtifact(id,take.file_ref));const media=await probeFile(source,{signal:ctx.signal});if(edit.out_seconds>media.duration+0.05)throw new TypeError('裁切超出真实视频时长')
      const output=join(root,`part${index}.mp4`),length=edit.out_seconds-edit.in_seconds,fade=timeline.transitions.find(t=>t.clip_id===edit.id)?.duration_seconds||0
      if(fade*2>length)throw new TypeError('淡入淡出时长超过片段一半')
      const vf=`scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${settings.fps}`+(fade?`,fade=t=in:st=0:d=${fade},fade=t=out:st=${length-fade}:d=${fade}`:'')
      const args=['-v','error','-ss',String(edit.in_seconds),'-i',source]
      if(!media.audio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo')
      args.push('-t',String(length),'-map','0:v:0','-map',media.audio?'0:a:0':'1:a:0','-vf',vf,'-af','aresample=48000','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-y',output)
      await command('ffmpeg',args,{signal:ctx.signal});pieces.push(output);cursor=edit.position_seconds+length;index++
    }
    const concat=join(root,'concat.txt');await writeFile(concat,pieces.map(path=>`file '${path}'`).join('\n'))
    const merged=join(root,'merged.mp4');await command('ffmpeg',['-v','error','-f','concat','-safe','0','-i',concat,'-c','copy','-y',merged],{signal:ctx.signal})
    const args=['-v','error','-i',merged],audioLabels=['[0:a]'];let audioIndex=1
    if(timeline.audio_tracks_ref){const tracks=JSON.parse((await service.projects.documents.readArtifact(id,timeline.audio_tracks_ref)).toString());if(!Array.isArray(tracks)||tracks.length>32)throw new TypeError('音轨格式无效')
      for(const track of tracks){if(!Number.isFinite(track.position_seconds)||track.position_seconds<0||!Number.isFinite(track.gain_db)||Math.abs(track.gain_db)>60||!Number.isFinite(track.in_seconds)||!Number.isFinite(track.out_seconds)||track.in_seconds<0||track.out_seconds<=track.in_seconds)throw new TypeError('音轨时间/音量无效');const path=join(root,`audio${audioIndex}.wav`);await writeFile(path,await service.projects.documents.readArtifact(id,track.file_ref));const media=await probeFile(path,{signal:ctx.signal});if(!media.audio||track.out_seconds>media.duration+0.05)throw new TypeError('音轨裁切超出真实时长');args.push('-i',path);filters.push(`[${audioIndex}:a]atrim=start=${track.in_seconds}:end=${track.out_seconds},asetpts=PTS-STARTPTS,volume=${track.gain_db}dB,adelay=${Math.round(track.position_seconds*1000)}:all=1[a${audioIndex}]`);audioLabels.push(`[a${audioIndex}]`);audioIndex++}
    }
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:normalize=0${settings.normalize_audio?',loudnorm=I=-16:TP=-1.5:LRA=11':''}[mix]`)
    const subtitles=timeline.subtitles_ref?(await service.projects.documents.readArtifact(id,timeline.subtitles_ref)).toString():'';let subtitleCount=0
    if(settings.subtitle_mode==='burn'&&subtitles.trim()){
      const track=await subtitleTrack(root,subtitles,duration,settings);subtitleCount=track.cue_count;args.push('-f','concat','-safe','0','-i',track.path);filters.push(`[${audioIndex}:v]fps=${settings.fps},format=rgba[caption];[0:v][caption]overlay=0:0:format=auto:shortest=1[picture]`)
    }else filters.push('[0:v]null[picture]')
    const final=join(root,'final.mp4');args.push('-filter_complex',filters.join(';'),'-map','[picture]','-map','[mix]','-ss',String(start),'-t',String(end-start),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',final)
    await command('ffmpeg',args,{signal:ctx.signal});const actual=await probeFile(final,{signal:ctx.signal});if(!actual.video||!actual.audio||Math.abs(actual.duration-(end-start))>0.35)throw new TypeError('成片导出技术验证失败')
    return {bytes:await readFile(final),subtitles:subtitles.trim()?clipSubtitles(subtitles,start,end):'',validation:{subtitle_renderer:settings.subtitle_mode==='burn'?'canvas-png-overlay':'sidecar',subtitle_count:subtitleCount,video:true,audio:true,duration_seconds:actual.duration,expected_duration_seconds:end-start,width:actual.video.width,height:actual.video.height,subtitle_mode:settings.subtitle_mode,normalized_audio:settings.normalize_audio}}
  })
}
