"""Local edit/verification. Reads server URLs; never invokes SSH or uploads media."""
import argparse,json,subprocess,textwrap,time
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'docs/implement/third-cup-preview'
OUT=ROOT/'out/third-cup-preview'
FONT='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
p=argparse.ArgumentParser();p.add_argument('--limit',type=int,default=10);p.add_argument('--wait',action='store_true');args=p.parse_args()
assert 1<=args.limit<=120
OUT.mkdir(parents=True,exist_ok=True)
manifest=json.loads((DATA/'manifest.json').read_text())
font=ImageFont.truetype(FONT,21)
records=[]; subtitle=''; started=time.time()
def run(command):return subprocess.run(command,check=True,capture_output=True,text=True)
def probe(path):return json.loads(run(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(path)]).stdout)
for shot in manifest['shots'][:args.limit]:
 if shot['subtitle']:subtitle=shot['subtitle']
 receipt_path=DATA/(shot['id']+'.receipt.json')
 deadline=time.time()+600
 while args.wait and (not receipt_path.exists() or json.loads(receipt_path.read_text()).get('result',{}).get('status')!='succeeded'):
  if time.time()>deadline:raise RuntimeError(f"{shot['id']}: not ready after 10 minutes; inspect original job, do not recreate")
  time.sleep(3)
 receipt=json.loads(receipt_path.read_text())
 assert receipt['result']['status']=='succeeded'
 result=receipt['result']; dest=OUT/(shot['id']+'.mp4')
 expected={'job_id':receipt['job_id'],'url':result['comfyui_view_url'],'subtitle':subtitle,'frames':72,'fps':24}
 stamp=OUT/(shot['id']+'.edit.json')
 if not dest.exists() or not stamp.exists() or json.loads(stamp.read_text())!=expected:
  layer=Image.new('RGBA',(384,512),(0,0,0,0));draw=ImageDraw.Draw(layer)
  lines=textwrap.wrap(subtitle,width=16) or ['']
  height=28*len(lines)+20
  draw.rectangle((0,512-height-14,384,512),fill=(0,0,0,170))
  for i,line in enumerate(lines):
   box=draw.textbbox((0,0),line,font=font);width=box[2]-box[0]
   draw.text(((384-width)/2,512-height-5+i*28),line,font=font,fill='white',stroke_width=1,stroke_fill='black')
  png=OUT/(shot['id']+'.subtitle.png');layer.save(png)
  temp=OUT/(shot['id']+'.partial.mp4')
  command=['ffmpeg','-nostdin','-v','error','-y','-rw_timeout','60000000','-i',expected['url'],'-loop','1','-i',str(png),'-filter_complex','[0:v]fps=24,trim=end_frame=72,setpts=PTS-STARTPTS[v];[v][1:v]overlay=0:0:shortest=1,format=yuv420p[out]','-map','[out]','-an','-frames:v','72','-c:v','libx264','-preset','fast','-crf','19','-movflags','+faststart',str(temp)]
  run(command);temp.replace(dest);stamp.write_text(json.dumps(expected,ensure_ascii=False,indent=2))
 media=probe(dest);video=next(s for s in media['streams'] if s['codec_type']=='video')
 assert (video['width'],video['height'],int(video['nb_read_frames']),video['r_frame_rate'])==(384,512,72,'24/1')
 assert not any(s['codec_type']=='audio' for s in media['streams'])
 records.append({'shot':shot['id'],'job_id':receipt['job_id'],'frames':72,'seconds':float(media['format']['duration']),'server_execution_ms':result.get('server_execution_ms'),'local_chain_ms':result.get('timings',{}).get('total_ms')})
 print(shot['id'],'edited and decoded',flush=True)
listing=OUT/f'concat-{args.limit:03d}.txt'
listing.write_text(''.join(f"file '{shot['id']}.mp4'\n" for shot in manifest['shots'][:args.limit]))
film=OUT/('第三杯咖啡-六分钟预览.mp4' if args.limit==120 else f'第三杯咖啡-{args.limit*3}秒试片.mp4')
run(['ffmpeg','-nostdin','-v','error','-y','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(film)])
media=probe(film);video=next(s for s in media['streams'] if s['codec_type']=='video')
assert int(video['nb_read_frames'])==args.limit*72
assert abs(float(media['format']['duration'])-args.limit*3)<.05
run(['ffmpeg','-nostdin','-v','error','-i',str(film),'-f','null','-'])
report={'shots':records,'film':str(film),'film_probe':media,'edit_wall_seconds':time.time()-started,'server_sum_ms':sum(r['server_execution_ms'] or 0 for r in records),'verified_unique_jobs':len(set(r['job_id'] for r in records)),'full_decode':'passed','audio':'silent; Chinese subtitles burned in'}
assert report['verified_unique_jobs']==args.limit
(DATA/f'acceptance-{args.limit:03d}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('FILM',film,flush=True)
