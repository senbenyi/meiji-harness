// 职责：在独立副本构建并运行同一业务验收，验证物理删除 Runpod 后可由独立适配器接替。
import test from 'node:test'
import { mkdtemp, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
for (const { provider, removed } of [{ provider: 'runpod' }, { provider: 'autodl', removed: 'runpod' }]) test(`complete business flow with ${provider}${removed ? ` after physically deleting ${removed}` : ''}`, { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'provider-removal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['src', 'scripts', 'package.json']) await cp(new URL(`../${name}`, import.meta.url), join(root, name), { recursive: true })
  await cp(new URL('./fixtures/provider-scenario.mjs', import.meta.url), join(root, 'scenario.mjs'))
  if (removed) {
    await rm(join(root, `src/servers/providers/${removed}`), { recursive: true })
    await mkdir(join(root, 'src/servers/providers/autodl'), { recursive: true })
    // 独立测试实现仅组合公共协议，不引用或复制 Runpod；真实 AutoDL 目录仍只预留。
    await writeFile(join(root, 'src/servers/providers/autodl/index.js'), `
import { createStandardAdapter } from '../../runtime/standard-adapter.js'
import { appendFileSync } from 'node:fs'
const adapter = createStandardAdapter({ id: 'autodl', label: 'AutoDL test fixture',
  buildGraph: (_backend, plan, jobId) => ({
    graph: { result: { class_type: 'SaveVideo', inputs: { prompt: plan.prompt, filename_prefix: jobId } } },
    outputNode: 'result', mode: plan.mode, profile: plan.profile || 'standard', workflowName: 'fixture-video',
    source: { path: 'independent-fixture', sha256: '0'.repeat(64) },
  })
})
for (const name of ['validate', 'connect', 'check', 'createClient', 'buildGraph', 'llmSettings', 'workflowSource']) {
  const original = adapter[name]
  adapter[name] = (...args) => {
    appendFileSync(process.env.PROVIDER_TRACE, JSON.stringify({ name, pid: process.pid }) + '\\n')
    return original(...args)
  }
}
export default adapter
`)
  }
  const options = { cwd: root, timeout: 50000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env,
    DSH_HOME: join(root, 'home'), ELYSIUM_STATE_ROOT: join(root, 'state'), ELYSIUM_SERVERS_FILE: join(root, 'servers.json'),
    COMFYUI_URL: 'http://unselected.invalid', PROVIDER_TRACE: join(root, 'trace.jsonl') } }
  try {
    await execute(process.execPath, ['scripts/build.mjs'], options)
    await execute(process.execPath, ['scenario.mjs', provider, removed || ''], options)
  } catch (error) { throw new Error(`${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`, { cause: error }) }
})

// 删除任何一个实现后，剩余渠道仍可发现、生成配置并通过同一入口路由。
for (const removed of ['bailian', 'byteplus', 'manual']) test(`remaining providers work after physically deleting ${removed}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'provider-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['src', 'package.json']) await cp(new URL(`../${name}`, import.meta.url), join(root, name), { recursive: true })
  await rm(join(root, `src/servers/providers/${removed}`), { recursive: true })
  await writeFile(join(root, 'check.mjs'), `
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolveConfig, withConfig } from './src/config.js'
import { listProviders, installProviderConfigs, providerConfigNames, resolveGenerationBackend, validateBackend, validateBackendPlan, thirdPartyChannels, thirdPartyModels } from './src/servers/runtime/index.js'
const home = process.env.DSH_HOME
await mkdir(home, { recursive: true })
await installProviderConfigs(home)
for (const file of providerConfigNames().filter(name => !name.includes('.example.'))) {
  const config = JSON.parse(await readFile(home + '/' + file, 'utf8'))
  config.enabled = true; config.api_key = 'fixture-secret'
  await writeFile(home + '/' + file, JSON.stringify(config))
}
await withConfig(resolveConfig({ comfyUrl: 'http://127.0.0.1:1' }), async () => {
  const providers = await listProviders()
  assert.equal(providers.some(item => item.id === '${removed}'), false)
  assert.ok(providers.filter(item => ['runpod', 'bailian', 'byteplus', 'manual'].includes(item.id)).every(item => item.available))
  const backend = await resolveGenerationBackend('video', { probe: async () => false })
  assert.equal(backend.provider, '${removed === 'bailian' ? 'byteplus' : 'bailian'}')
  await validateBackend(backend)
  const channels = await thirdPartyChannels()
  assert.equal(channels.some(item => item.id === '${removed}'), false)
  assert.doesNotMatch(JSON.stringify(await thirdPartyModels()), /fixture-secret/)
  await assert.rejects(validateBackend({ ...backend, provider: '${removed}' }), { code: 'PROVIDER_UNAVAILABLE' })
})
`)
  // BytePlus 模板可能没有模型 ID，测试只补公开模型字段，不改实现。
  const example = join(root, 'src/servers/providers/byteplus/config.example.json')
  if (removed !== 'byteplus') {
    const { readFile } = await import('node:fs/promises')
    const value = JSON.parse(await readFile(example, 'utf8'))
    value.video.model = 'fixture-video'; value.image.model = 'fixture-image'
    await writeFile(example, JSON.stringify(value))
  }
  await execute(process.execPath, ['check.mjs'], { cwd: root, env: { ...process.env, DSH_HOME: join(root, 'home'), ELYSIUM_SERVERS_FILE: join(root, 'absent.json') } })
})
