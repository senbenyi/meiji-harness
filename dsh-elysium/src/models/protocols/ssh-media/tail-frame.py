# coding: utf-8
# 职责：解码视频尾部并原子保存最后一帧，同一不可变任务复用同一图片。
import json, pathlib, subprocess, sys, uuid, re

p = json.load(sys.stdin)
if not re.fullmatch(r'[a-f0-9]{32}', p['job_id']):
    raise ValueError('Invalid source job')
root = pathlib.Path(p['output_root']).resolve()
source = (root / p['subfolder'] / p['filename']).resolve()
if not source.is_relative_to(root) or not source.is_file():
    raise ValueError('Source video is outside output or missing')
target = root / 'elysium' / 'references' / p['job_id'] / 'last.png'
target.parent.mkdir(parents=True, exist_ok=True)
if not target.is_file():
    temporary = target.with_name(str(uuid.uuid4()) + '.png')
    try:
        # 更新同一图片直至解码结束，保留真正的最后一帧，而非时长附近的近似帧。
        subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-sseof', '-1', '-i', str(source),
                        '-map', '0:v:0', '-an', '-vsync', '0', '-update', '1', str(temporary)], check=True, timeout=45)
        if not temporary.is_file() or not temporary.stat().st_size:
            raise ValueError('No decoded tail frame')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
print(json.dumps({'status': 'succeeded'}))
