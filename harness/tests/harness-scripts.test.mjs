import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

const root = new URL('../../', import.meta.url).pathname
const localScript = name => readFile(join(root, 'harness/scripts', name), 'utf8')

test('install only copies Harness-owned configuration and installs the packaged plugin', async () => {
  const install = await localScript('install.mjs')
  assert.match(install, /pnpm.*@deepseek-ai\/dsh/s)
  assert.match(install, /PNPM_HOME/)
  assert.match(install, /rm\(join\(target, '\.agent-presets', 'elysium-teaching'\), \{ recursive: true, force: true \}\)/)
  assert.match(install, /\['\.agent-presets', 'profiles', 'settings\.yaml', 'storages\/elysium\/pools\/skills'\]/)
  assert.match(install, /package:registry/)
  assert.match(install, /existsSync\(join\(webProfile, 'pnpm-workspace.yaml'\)\) \? \['--workspace-root'\] : \[\]/)
  assert.match(install, /join\(plugin, 'registry'\)/)
  assert.doesNotMatch(install, /servers\.json|providerConfig|bailian|byteplus|dsh-elysium\/src/)
})

test('start manages only the Harness process and never rewrites business or model configuration', async () => {
  const start = await localScript('start.mjs')
  assert.match(start, /body\.includes\('dsh web authentication required'\)/)
  assert.match(start, /spawn\('dsh', \['web'/)
  assert.match(start, /未找到 dsh 命令/)
  assert.match(start, /PATH: pathWithPnpm/)
  assert.match(start, /DSH_AGENTS_HOME: join\(home, 'agents'\), DSH_HOME: home/)
  assert.match(start, /QWEN38_LOCAL_API_KEY: process\.env\.QWEN38_LOCAL_API_KEY \|\| 'local-vllm'/)
  assert.match(start, /detached: true/)
  assert.doesNotMatch(start, /dsh-elysium|servers\.json|applyLlm|tunnel|COMFYUI|ELYSIUM|loadEnvFile|\.dsh\/\.env/)
  for (const name of ['server-startup.mjs', 'storage-template.mjs', 'tunnel.mjs']) await assert.rejects(access(join(root, 'harness/scripts', name)), { code: 'ENOENT' })
})

test('Hong Kong deployment selects loopback model settings and describes one-command installation', async () => {
  const settings = await readFile(join(root, 'harness/.dsh/settings.hk.yaml'), 'utf8')
  const install = await localScript('install.mjs')
  const start = await localScript('start.mjs')
  assert.match(settings, /baseURL: http:\/\/127\.0\.0\.1:28000\/v1/)
  assert.match(install, /DSH_INSTALL_ENV === 'hk'/)
  assert.match(install, /香港已有同名 Skill 且内容不同/)
  assert.match(start, /'--host', process\.env\.DSH_BIND_HOST/)
  const output = execFileSync(process.execPath, [join(root, 'harness/scripts/deploy-hk.mjs'), '--dry-run'], { encoding: 'utf8' })
  assert.match(output, /veo-hk/)
  assert.match(output, /默认 Skill 和插件/)
})
