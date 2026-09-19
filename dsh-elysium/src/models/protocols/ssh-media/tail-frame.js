// 职责：在视频所属服务器提取真实尾帧，仅返回服务器图片 URL。
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
export async function extractTailFrameRemote(backend, source, outputRoot, python = 'python3') {
  const alias = backend.connection?.ssh_alias, base = new URL(backend.base_url.replace(/\/?$/, '/')), media = new URL(source.url)
  if (!alias || !/^[a-zA-Z0-9_.-]+$/.test(alias) || !/^[a-zA-Z0-9_./-]+$/.test(python)) throw new Error('尾帧提取需要已登记的 SSH 媒体服务器')
  if (!/^[a-f0-9]{32}$/.test(source.job_id)) throw new Error('尾帧来源任务 ID 无效')
  if (media.origin !== base.origin || media.pathname !== new URL('view', base).pathname || media.searchParams.get('type') !== 'output') throw new Error('尾帧视频必须属于原任务的媒体服务器')
  const filename = media.searchParams.get('filename'), subfolder = media.searchParams.get('subfolder') || ''
  if (!filename || /[/\\]/.test(filename) || subfolder.split(/[/\\]/).includes('..')) throw new Error('尾帧视频路径无效')
  const script = (await readFile(new URL('./tail-frame.py', import.meta.url))).toString('base64')
  await new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', alias, `${python} -c "import base64;exec(base64.b64decode('${script}'))"`], { stdio: ['pipe', 'pipe', 'pipe'] })
    let error = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('尾帧提取超时，可继续原队列重试')) }, 60000)
    child.stdout.resume(); child.stderr.on('data', data => error += data)
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', code => { clearTimeout(timer); code ? reject(new Error(error.slice(-800) || '尾帧提取失败')) : resolve() })
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ output_root: outputRoot, job_id: source.job_id, filename, subfolder }))
  })
  const url = new URL('view', base)
  url.search = new URLSearchParams({ filename: 'last.png', subfolder: `elysium/references/${source.job_id}`, type: 'output' }).toString()
  return { url: url.href, source_job_id: source.job_id }
}
