#!/usr/bin/env node

// 职责：在本机生成香港中转与直连 SSH 别名、固定主机公钥，并核对 Elysium 已登记的连接身份。
import { execFileSync, spawnSync } from 'node:child_process'
import { access, chmod, copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const block = (alias, fields) => [`Host ${alias}`, ...fields.map(([name, value]) => `    ${name} ${value}`), ''].join('\n')

// 字段须与原机一致：HostName/User/Port/IdentityFile/ProxyJump/HostKeyAlias 参与 Elysium 连接身份哈希。
export function renderBlocks({ hk, gpus }) {
  const blocks = []
  for (const gpu of gpus) {
    blocks.push([`${gpu.alias}-direct`, block(`${gpu.alias}-direct`, [['HostName', gpu.direct.hostname], ['User', 'root'], ['Port', gpu.direct.port],
      ['IdentityFile', `~/.ssh/${gpu.identity}`], ['IdentitiesOnly', 'yes'], ['ServerAliveInterval', 20], ['ServerAliveCountMax', 3]])])
  }
  blocks.push([hk.alias, block(hk.alias, [['HostName', hk.hostname], ['User', hk.user], ['IdentityFile', `~/.ssh/${hk.identity}`],
    ['IdentitiesOnly', 'yes'], ['ServerAliveInterval', 15], ['ServerAliveCountMax', 3]])])
  for (const gpu of gpus) {
    blocks.push([gpu.alias, block(gpu.alias, [['HostName', '127.0.0.1'], ['Port', gpu.relay_port], ['User', 'root'], ['HostKeyAlias', gpu.alias],
      ['ProxyJump', hk.alias], ['IdentityFile', `~/.ssh/${gpu.identity}`], ['IdentitiesOnly', 'yes'], ['ServerAliveInterval', 15], ['ServerAliveCountMax', 3]])])
  }
  return blocks
}

export function upsertHostBlock(config, alias, text) {
  const lines = config.split('\n')
  const start = lines.findIndex(line => new RegExp(`^\\s*Host\\s+${alias.replace(/[.]/g, '\\.')}\\s*$`).test(line))
  if (start === -1) return `${config.replace(/\n*$/, '\n\n')}${text}`
  let end = lines.findIndex((line, index) => index > start && /^\s*(?:Host|Match)\s+/i.test(line))
  if (end === -1) end = lines.length
  return [...lines.slice(0, start), ...text.split('\n'), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n')
}

export function knownHostEntries({ hk, gpus }) {
  return [[hk.hostname, hk.host_key], ...gpus.flatMap(gpu => [[gpu.alias, gpu.host_key], [`[${gpu.direct.hostname}]:${gpu.direct.port}`, gpu.host_key]])]
}

// 已有条目与固定公钥不一致时拒绝覆盖，避免把被替换的主机静默加入信任。
export function missingKnownHosts(entries, lookup) {
  return entries.filter(([name, key]) => {
    const existing = lookup(name)
    if (existing.length && !existing.includes(key)) throw new Error(`known_hosts 中 ${name} 的主机公钥与 init/relay.json 不一致，请人工核对`)
    return !existing.length
  })
}

const lookupKnownHost = file => name => {
  const result = spawnSync('ssh-keygen', ['-F', name, '-f', file], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/).slice(1, 3).join(' ')) : []
}

async function checkIdentities(gpus) {
  const { defaultElysiumHome } = await import('../dsh-elysium/src/database/paths.js')
  const { readRegistry } = await import('../dsh-elysium/src/database/managers/registry.js')
  const { sshIdentity } = await import('../dsh-elysium/src/worker/models/catalog/transport.js')
  const settings = join(defaultElysiumHome(), 'config', 'settings.json')
  try { await access(settings) } catch {
    console.log(`未找到 ${settings}：拷贝 Elysium 数据后重新执行以核对登记身份`)
    return true
  }
  let consistent = true
  for (const server of readRegistry(settings).servers) {
    for (const [kind, service] of Object.entries(server.services)) {
      if (service.transport !== 'ssh' || !gpus.some(gpu => gpu.alias === service.ssh_alias)) continue
      const same = service.ssh_identity === sshIdentity(service.ssh_alias)
      consistent &&= same
      console.log(`${same ? '登记一致' : '登记不一致'}：${server.id}/${kind} → ${service.ssh_alias}`)
    }
  }
  return consistent
}

async function main() {
  const relay = JSON.parse(await readFile(new URL('./relay.json', import.meta.url), 'utf8'))
  const sshDirectory = join(homedir(), '.ssh')
  const configFile = join(sshDirectory, 'config')
  const knownHostsFile = join(sshDirectory, 'known_hosts')

  for (const identity of [relay.hk.identity, ...relay.gpus.map(gpu => gpu.identity)]) {
    const key = join(sshDirectory, identity)
    try { await access(key) } catch { throw new Error(`缺少私钥 ${key}：请从原电脑复制（含 .pub）后重试`) }
    if (((await stat(key)).mode & 0o077) !== 0) await chmod(key, 0o600)
  }

  const current = await readFile(configFile, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
  const next = renderBlocks(relay).reduce((config, [alias, text]) => upsertHostBlock(config, alias, text), current)
  if (next !== current) {
    if (current) await copyFile(configFile, `${configFile}.bak-relay`)
    const temporaryFile = `${configFile}.tmp-${process.pid}`
    await writeFile(temporaryFile, next, { mode: 0o600 })
    await rename(temporaryFile, configFile)
    console.log(`已更新 ${configFile}${current ? `，原配置备份：${configFile}.bak-relay` : ''}`)
  } else console.log('SSH 配置已是最新')

  const missing = missingKnownHosts(knownHostEntries(relay), lookupKnownHost(knownHostsFile))
  if (missing.length) {
    const existing = await readFile(knownHostsFile, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
    await writeFile(knownHostsFile, `${existing.replace(/\n*$/, existing ? '\n' : '')}${missing.map(([name, key]) => `${name} ${key}`).join('\n')}\n`, { mode: 0o600 })
    console.log(`已写入主机公钥：${missing.map(([name]) => name).join('、')}`)
  }

  let ok = true
  for (const alias of [relay.hk.alias, ...relay.gpus.flatMap(gpu => [gpu.alias, `${gpu.alias}-direct`])]) {
    try {
      execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', alias, 'true'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30000 })
      console.log(`SSH 登录通过：${alias}`)
    } catch { ok = false; console.log(`SSH 登录失败：${alias}`) }
  }
  if (!await checkIdentities(relay.gpus) || !ok) process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
