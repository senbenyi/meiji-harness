// 职责：通过登记的 SSH 身份调用远端合片器，只传清单，不下载媒体。
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
export async function composeRemote(backend, input, outputRoot, python = 'python3') {
  const alias = backend.connection?.ssh_alias
  if (!alias || !/^[a-zA-Z0-9_.-]+$/.test(alias)) throw new Error('合片需要已经登记的 SSH 媒体服务器')
  if (!/^[a-f0-9-]{36}$/.test(input.id)) throw new Error('导出 ID 无效')
  if (!/^[a-zA-Z0-9_./-]+$/.test(python)) throw new Error('合片 Python 路径无效')
  const script = (await readFile(new URL('./compose.py', import.meta.url))).toString('base64')
  const payload = { ...input, output_root: outputRoot, remote_port: backend.connection.remote_port }
  const result = await new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', alias, `${python} -c "import base64;exec(base64.b64decode('${script}'))"`], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('合片服务器连接超时')) }, 20000)
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error(err.slice(-800) || '合片调用失败')); else { try { resolve(JSON.parse(out)) } catch { reject(new Error('合片服务器返回格式无效')) } } })
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload))
  })
  if (result.status === 'succeeded') {
    const url = new URL('view', backend.base_url.replace(/\/?$/, '/'))
    url.search = new URLSearchParams({ filename: 'final.mp4', subfolder: `elysium/exports/${input.id}`, type: 'output' }).toString()
    result.url = url.href
  }
  return result
}
