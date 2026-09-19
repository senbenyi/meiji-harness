# coding: utf-8
# 职责：在媒体服务器逐段裁切混音并合片，持久化状态，重复调用复用同一导出。
import json, os, sys, subprocess, pathlib, urllib.parse, fcntl
p = json.load(sys.stdin)
root = pathlib.Path(p['output_root']) / 'elysium' / 'exports' / p['id']
root.mkdir(parents=True, exist_ok=True)
status_file = root / 'status.json'
def save(v):
    temp = root / 'status.tmp'
    temp.write_text(json.dumps(v)); temp.replace(status_file)
def state():
    return json.loads(status_file.read_text()) if status_file.exists() else {'status': 'pending'}
lock = (root / 'lock').open('w')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print(json.dumps(state())); sys.exit(0)
if state().get('status') == 'succeeded':
    print(json.dumps(state())); sys.exit(0)
# Detach before expensive work. The parent reports status and later polls reuse it.
pid = os.fork()
if pid:
    print(json.dumps({'status': 'running'})); sys.exit(0)
os.setsid()
log = (root / 'render.log').open('a')
os.dup2(log.fileno(), 1); os.dup2(log.fileno(), 2)
def source(url):
    u = urllib.parse.urlsplit(url)
    # Local tunnel URLs refer to this media service on the remote host.
    if u.hostname in ['127.0.0.1', 'localhost']:
        u = u._replace(netloc='127.0.0.1:' + str(p['remote_port']))
    return urllib.parse.urlunsplit(u)
def probe(url):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',url]))
def run(args):
    subprocess.run(['ffmpeg','-nostdin','-y','-v','error'] + args, check=True, stdout=log, stderr=log)
try:
    clips = p['timeline']['clips']; outputs = []; total = 0
    width, height = p['size']
    for i,c in enumerate(clips):
        save({'status':'running','completed':i,'total':len(clips)})
        url = source(c['url']); info = probe(url)
        duration = min(float(c['end']), float(info['format']['duration'])) - float(c['start'])
        if duration <= 0: raise ValueError('裁切超出实际视频时长')
        target = root / ('clip-%04d.mp4' % i)
        vf = 'scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24' % (width,height,width,height)
        if c.get('transition') == 'fade': vf += ',fade=t=in:st=0:d=0.2,fade=t=out:st=%.3f:d=0.2' % max(0,duration-.2)
        if c.get('subtitle'):
            (root / ('subtitle-%d.txt' % i)).write_text(c['subtitle'])
            vf += ",drawtext=font='Noto Sans CJK SC':textfile='%s':expansion=none:fontcolor=white:fontsize=28:borderw=2:x=(w-tw)/2:y=h-th-36" % (root / ('subtitle-%d.txt' % i))
        args = ['-ss',str(c['start']),'-i',url]
        has_audio = any(s['codec_type']=='audio' for s in info['streams'])
        if not has_audio: args += ['-f','lavfi','-i','anullsrc=r=32000:cl=stereo']
        args += ['-t',str(duration),'-map','0:v:0','-map','0:a:0' if has_audio else '1:a:0','-vf',vf,'-af','volume=%s' % c.get('volume',1),'-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-ar','32000','-ac','2',str(target)]
        run(args); outputs.append(target); total += duration
    (root / 'list.txt').write_text(''.join("file '%s'\n" % path for path in outputs))
    run(['-f','concat','-safe','0','-i',str(root/'list.txt'),'-c','copy','-movflags','+faststart',str(root/'joined.mp4')])
    music = p['timeline'].get('music_url')
    if music:
        run(['-i',str(root/'joined.mp4'),'-stream_loop','-1','-i',source(music),'-filter_complex','[1:a]volume=%s[m];[0:a][m]amix=inputs=2:duration=first[a]' % p['timeline'].get('music_volume',.2),'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-t',str(total),'-movflags','+faststart',str(root/'final.mp4')])
    else: (root/'joined.mp4').replace(root/'final.mp4')
    save({'status':'succeeded','duration':float(probe(str(root/'final.mp4'))['format']['duration']),'completed':len(clips),'total':len(clips)})
except Exception as error: save({'status':'failed','error':str(error)})
finally: lock.close()
