// 职责：验证 SSH 别名的解析身份，只建立和复用本功能拥有的控制连接。
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createServer } from 'node:net'
import { registryPath } from '../registry/store.js'
export function sshIdentity(alias, exec = execFileSync) {
  const config = exec('ssh', ['-G', '--', alias], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
  // 连接身份包括 SSH 解析后的主机、用户、跳板和密钥路径，绝不读取密钥内容。
  const identity = config.split('\n').filter(line => /^(hostname|user|port|identityfile|proxyjump|proxycommand|hostkeyalias) /.test(line)).sort().join('\n')
  if (!/^hostname /m.test(identity)) throw new Error('无法解析 SSH 主机身份')
  return createHash('sha256').update(identity).digest('hex')
}
export async function portAvailable(port) {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error(`本地端口 ${port} 已被占用，未终止任何进程`)))
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
}
export async function ensureConnection(backend, { identity = sshIdentity, run = spawnSync, available = portAvailable, directory = join(dirname(registryPath()), 'runtime', 'tunnels') } = {}) {
  const service = backend.connection
  if (service?.transport !== 'ssh') return
  if (!service.ssh_identity || service.ssh_identity !== identity(service.ssh_alias)) throw new Error('SSH 别名解析身份发生变化，请以新服务器 ID 重新登记')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(JSON.stringify([backend.server_id, backend.instance_id, backend.deployment_id, service])).digest('hex').slice(0, 20)
  const control = join(directory, key)
  const checked = run('ssh', ['-S', control, '-O', 'check', service.ssh_alias], { stdio: 'ignore', timeout: 10000 })
  if (checked.status === 0) return { control, reused: true }
  await available(service.local_port)
  const remote = service.remote_host.includes(':') ? `[${service.remote_host}]` : service.remote_host
  const result = run('ssh', ['-M', '-S', control, '-f', '-N', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${service.local_port}:${remote}:${service.remote_port}`, service.ssh_alias], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 })
  if (result.status !== 0) throw new Error(`SSH 隧道建立失败（${result.status ?? result.error?.code ?? 'unknown'}），原连接未变更`)
  return { control, reused: false }
}
