import {existsSync} from 'node:fs'
import {createCanvas,GlobalFonts} from '@napi-rs/canvas'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {srtTime} from '../../../shared/media/media.js'

export function parseSubtitles(text){
 const cues=[]
 for(const block of text.replaceAll('\r\n','\n').replaceAll('\r','\n').trim().split(/\n\s*\n/)){
  if(!block.trim())continue
  const lines=block.split('\n');if(/^\d+$/.test(lines[0].trim()))lines.shift()
  const match=lines.shift()?.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*$/)
  if(!match)throw new TypeError('字幕需为有效SRT时间码')
  const seconds=i=>Number(match[i])*3600+Number(match[i+1])*60+Number(match[i+2])+Number(match[i+3].padEnd(3,'0'))/1000,start=seconds(1),end=seconds(5)
  if(end<=start||!lines.join('\n').trim())throw new TypeError('字幕时间范围或正文为空')
  cues.push({start,end,text:lines.join('\n')})
 }
 return cues.sort((a,b)=>a.start-b.start)
}
export function clipSubtitles(text,start,end){
 return parseSubtitles(text).filter(c=>c.end>start&&c.start<end).map((cue,index)=>`${index+1}\n${srtTime(Math.max(cue.start,start)-start)} --> ${srtTime(Math.min(cue.end,end)-start)}\n${cue.text}\n`).join('\n')
}
function captionFont(text){
 if(!GlobalFonts.has('Drama CJK'))for(const path of [process.env.DRAMA_SUBTITLE_FONT,'/System/Library/Fonts/Supplemental/Songti.ttc','/System/Library/Fonts/PingFang.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc','C:/Windows/Fonts/msyh.ttc'].filter(Boolean))if(existsSync(path)&&GlobalFonts.registerFromPath(path,'Drama CJK'))break
 const family=['Drama CJK','PingFang SC','Microsoft YaHei','Noto Sans CJK SC','WenQuanYi Zen Hei'].find(name=>GlobalFonts.has(name))
 if(/[\u3400-\u9fff]/.test(text)&&!family)throw new TypeError('烧录中文字幕需中文字体，请安装Noto Sans CJK或设置DRAMA_SUBTITLE_FONT指向字体文件')
 return family?`"${family}", sans-serif`:'sans-serif'
}
/** 不依赖ffmpeg的libass：文字绘成透明PNG轨道，再由overlay实际烧入视频。 */
export async function subtitleTrack(root,text,duration,{width,height,fps}){
 const font=captionFont(text),cues=parseSubtitles(text).filter(c=>c.start<duration),events=[]
 cues.forEach((cue,index)=>{events.push({time:Math.max(0,cue.start),id:index,add:true},{time:Math.min(duration,cue.end),id:index,add:false})})
 events.sort((a,b)=>a.time-b.time||Number(a.add)-Number(b.add));const active=new Set(),intervals=[];let cursor=0,index=0
 while(index<events.length){const time=events[index].time;if(time>cursor)intervals.push({text:[...active].sort((a,b)=>a-b).map(id=>cues[id].text).join('\n'),duration:time-cursor});while(index<events.length&&events[index].time===time){if(events[index].add)active.add(events[index].id);else active.delete(events[index].id);index++}cursor=time}
 if(cursor<duration)intervals.push({text:[...active].sort((a,b)=>a-b).map(id=>cues[id].text).join('\n'),duration:duration-cursor})
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d'),cache=new Map(),rows=[];let count=0
 const render=async value=>{if(cache.has(value))return cache.get(value);const path=join(root,`subtitle-${count++}.png`);ctx.clearRect(0,0,width,height)
  if(value){const size=Math.max(12,Math.round(width*.035)),lineHeight=Math.round(size*1.4),maxWidth=width*.9;ctx.font=`${size}px ${font}`;ctx.textAlign='center';ctx.textBaseline='bottom';const lines=[]
   for(const paragraph of value.split('\n')){let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line=''}line+=char}if(line)lines.push(line)}
   const bottom=height-Math.max(4,Math.round(height*.06)),top=bottom-lines.length*lineHeight;ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(width*.03,Math.max(0,top),width*.94,lines.length*lineHeight+5)
   ctx.lineWidth=Math.max(1,size*.09);ctx.strokeStyle='#000';ctx.fillStyle='#fff';lines.forEach((line,i)=>{const y=bottom-(lines.length-1-i)*lineHeight;ctx.strokeText(line,width/2,y);ctx.fillText(line,width/2,y)})
  }
  await writeFile(path,canvas.toBuffer('image/png'));cache.set(value,path);return path
 }
 for(const interval of intervals){const path=await render(interval.text);rows.push(`file '${path}'\nduration ${interval.duration.toFixed(6)}`)}
 rows.push(`file '${await render('')}'\nduration ${(1/fps).toFixed(6)}`)
 const path=join(root,'subtitle-track.txt');await writeFile(path,rows.join('\n'));return {path,cue_count:cues.length}
}
