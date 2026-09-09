"""Read and validate existing server media; never run inference or transform images."""
import base64
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

request = json.loads(base64.b64decode(sys.argv[1]))
root = pathlib.Path(request['output_root']).resolve()
operation = request['operation']
if operation == 'output':
    descriptor = request['descriptor']
    if descriptor.get('type') != 'output':
        raise ValueError('Expected output artifact')
    path = (root / descriptor.get('subfolder', '') / descriptor['filename']).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError('Artifact outside output directory')
else:
    path = pathlib.Path(request['path']).resolve(strict=True)
if not path.is_file() or path.stat().st_size == 0:
    raise ValueError('Missing or empty media')
if path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.mkv', '.wav', '.mp3', '.flac', '.m4a', '.ogg'):
    raise ValueError('Unsupported media file')
probe = json.loads(subprocess.check_output([request['ffprobe'], '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], timeout=30))
if not probe.get('streams'):
    raise ValueError('No media streams')
result = {'server_path': str(path), 'size_bytes': path.stat().st_size, 'probe': probe}
if operation == 'output':
    subprocess.run([request['ffmpeg'], '-v', 'error', '-xerror', '-nostdin', '-i', str(path), '-f', 'null', '-'], check=True, timeout=300)
with path.open('rb') as stream:
    digest = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(block)
    result['sha256'] = digest.hexdigest()
if request.get('timestamps'):
    frames = json.loads(subprocess.check_output([request['ffprobe'], '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(path)], timeout=120))
    result['timestamps'] = [float(frame['best_effort_timestamp_time']) for frame in frames['frames']]
if operation == 'input':
    target = pathlib.Path(request['input_root']) / ('elysium-' + result['sha256'] + path.suffix.lower())
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.resolve() != path:
        shutil.copyfile(path, target)
    result['name'] = target.name
print(json.dumps(result))
