// 职责：验证 SSH 别名的解析身份，只建立和复用本功能拥有的控制连接。
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rm, rmdir } from '../../../database/files.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { runtimeRoot } from '../../../database/paths.js'
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

const runControl = (run, action, control, alias) => run('ssh', ['-S', control, '-O', action, alias], { stdio: 'ignore', timeout: 10000 })
const names = async directory => readdir(directory).catch(error => {
  if (error.code === 'ENOENT') return []
  throw error
})
async function stopControls(directory, prefix, alias, run) {
  let stopped = false
  for (const name of await names(directory)) {
    if (!name.startsWith(prefix)) continue
    const control = join(directory, name)
    if (runControl(run, 'check', control, alias).status === 0) {
      if (runControl(run, 'exit', control, alias).status !== 0) return false
      stopped = true
    }
    await rm(control, { force: true })
  }
  return stopped
}
async function stopLegacyControls(directory, port, run) {
  let stopped = false
  for (const name of await names(directory)) {
    if (!name.endsWith('.json')) continue
    const metadata = join(directory, name)
    let owned
    try { owned = JSON.parse(await readFile(metadata, 'utf8')) } catch { continue }
    if (owned?.local_port !== port || typeof owned.ssh_alias !== 'string') continue
    const control = join(directory, name.slice(0, -5))
    if (runControl(run, 'check', control, owned.ssh_alias).status === 0) {
      if (runControl(run, 'exit', control, owned.ssh_alias).status !== 0) return false
      stopped = true
    }
    await rm(control, { force: true })
    await rm(metadata, { force: true })
  }
  await rmdir(directory).catch(error => { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error })
  return stopped
}
const defaultControlDirectory = () => join(process.platform === 'darwin' ? '/tmp' : tmpdir(),
  `dsh-el-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(runtimeRoot()).digest('hex').slice(0, 12)}`)

const forwardHealthy = async url => {
  try { await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }); return true }
  catch { return false }
}

export async function ensureConnection(backend, { identity = sshIdentity, run = spawnSync, available = portAvailable, healthy = forwardHealthy, directory, legacyDirectory } = {}) {
  const service = backend.connection
  if (service?.transport !== 'ssh') return
  directory ||= defaultControlDirectory()
  legacyDirectory ||= join(runtimeRoot(), 'tunnels')
  if (!service.ssh_identity || service.ssh_identity !== identity(service.ssh_alias)) throw new Error('SSH 别名解析身份发生变化，请以新服务器 ID 重新登记')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const key = createHash('sha256').update(JSON.stringify([backend.server_id, backend.instance_id, backend.deployment_id, service])).digest('hex').slice(0, 20)
  const control = join(directory, `${service.local_port}-${key}`)
  if (runControl(run, 'check', control, service.ssh_alias).status === 0) {
    if (!backend.base_url || await healthy(backend.base_url)) return { control, reused: true }
    if (runControl(run, 'exit', control, service.ssh_alias).status !== 0) throw new Error('SSH 隧道转发失效且无法关闭旧连接')
    await rm(control, { force: true })
  }
  await stopLegacyControls(legacyDirectory, service.local_port, run)
  try { await available(service.local_port) } catch (occupied) {
    if (!await stopControls(directory, `${service.local_port}-`, service.ssh_alias, run)) throw occupied
    await available(service.local_port)
  }
  const remote = service.remote_host.includes(':') ? `[${service.remote_host}]` : service.remote_host
  const result = run('ssh', ['-M', '-S', control, '-f', '-N', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${service.local_port}:${remote}:${service.remote_port}`, service.ssh_alias], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 })
  if (result.status !== 0) throw new Error(`SSH 隧道建立失败（${result.status ?? result.error?.code ?? 'unknown'}），原连接未变更`)
  return { control, reused: false }
}
