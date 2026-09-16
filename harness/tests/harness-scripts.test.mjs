import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url).pathname
const localScript = name => readFile(join(root, 'harness/scripts', name), 'utf8')

test('local scripts install dependencies and start the declared legacy tunnel before Harness', async () => {
  const install = await localScript('install.mjs'), start = await localScript('start.mjs')
  assert.match(install, /pnpm.*@deepseek-ai\/dsh/s)
  assert.match(install, /package:registry/)
  assert.match(install, /pnpm.*add.*--workspace-root.*registry/s)
  assert.match(install, /entry === '\.credentials\.yaml'/)
  assert.match(install, /entry === '\.env\.example'/)
  assert.match(install, /chmod\(sensitiveFile, 0o600\)/)
  assert.match(start, /new URL\('\.\/tunnel\.mjs', import\.meta\.url\)/)
  assert.match(start, /execFileSync\(process\.execPath, \[tunnelScript, defaultTunnelAlias\(\)\]/)
  assert.match(start, /默认文本隧道启动失败，继续启动 Harness/)
  assert.match(start, /body\.includes\('dsh web authentication required'\)/)
  assert.match(start, /Harness 已在运行/)
  assert.match(start, /execFileSync\('lsof', \['-nP'/)
  assert.match(start, /String\(harness.pid\)/)
  assert.match(start, /spawn\('dsh', \['web'/)
  assert.match(start, /detached: true/)
  assert.match(start, /stdio: \['ignore', log, log\]/)
  assert.match(start, /harness\.unref\(\)/)
  assert.match(start, /Harness 已在后台启动/)
  assert.doesNotMatch(install, /comfyui\.mjs|tunnel\.mjs|ssh|system_stats/)
  assert.doesNotMatch(start, /comfyui\.mjs|spawnSync\('ssh'|system_stats/)
})

test('service management and tunnels use public routing only', async () => {
  const service = await readFile(join(root, 'dsh-elysium/scripts/server-service.mjs'), 'utf8')
  const localTunnel = await localScript('tunnel.mjs')
  assert.match(service, /manageProvider\(provider, action\)/)
  assert.doesNotMatch(service, /workspace|spawn|fetch/)
  assert.match(localTunnel, /connectBackend/)
  assert.match(localTunnel, /legacyTunnelBackend\(target\)/)
  assert.doesNotMatch(localTunnel, /veo-qwen38/)
  const legacy = JSON.parse(await readFile(join(root, 'dsh-elysium/src/servers/providers/manual/definition.json'), 'utf8'))
  assert.equal(legacy.legacy_tunnel.connection.ssh_alias, 'veo-qwen38')
  assert.doesNotMatch(localTunnel, /fetch\(|process\.kill/)
  assert.match(await localScript('install.mjs'), /entry === 'servers\.json'.*entry === 'servers\.example\.json'/)
})
