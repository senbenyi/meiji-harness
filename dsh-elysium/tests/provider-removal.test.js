// 职责：在独立副本构建并运行同一业务验收，验证物理删除 Runpod 后可由独立适配器接替。
import test from 'node:test'
import { mkdtemp, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
test('complete business flow with autodl after physically deleting runpod', { timeout: 60000 }, async t => {
  const provider = 'autodl', removed = 'runpod'
  const root = await mkdtemp(join(tmpdir(), 'provider-removal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['src', 'scripts', 'package.json']) await cp(new URL(`../${name}`, import.meta.url), join(root, name), { recursive: true })
  await cp(new URL('./fixtures/provider-scenario.mjs', import.meta.url), join(root, 'scenario.mjs'))
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
  const options = { cwd: root, timeout: 50000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env,
    DSH_HOME: join(root, 'dsh-home'), ELYSIUM_HOME: join(root, 'home'), ELYSIUM_STATE_ROOT: join(root, 'state'), ELYSIUM_SERVERS_FILE: join(root, 'servers.json'), ELYSIUM_CONFIG_FILE: join(root, 'config.json'),
    COMFYUI_URL: 'http://unselected.invalid', PROVIDER_TRACE: join(root, 'trace.jsonl') } }
  try {
    await execute(process.execPath, ['scripts/build.mjs'], options)
    await execute(process.execPath, ['scenario.mjs', provider, removed], options)
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
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolveConfig, withConfig } from './src/config.js'
import { listProviders, resolveGenerationBackend, validateBackend, validateBackendPlan, thirdPartyChannels, thirdPartyModels } from './src/servers/runtime/index.js'
const home = process.env.ELYSIUM_HOME, providers = home + '/providers'
await mkdir(providers, { recursive: true })
if (existsSync('./src/servers/providers/bailian')) await writeFile(providers + '/bailian.json', JSON.stringify({ enabled: true, base_url: 'https://bailian.test/api/v1', api_key: 'fixture-secret', video: { text_model: 'wan2.6-t2v', image_model: 'wan2.6-i2v', duration: 5, resolution: '720P', ratio: '9:16', prompt_extend: false, watermark: false } }))
if (existsSync('./src/servers/providers/byteplus')) await writeFile(providers + '/byteplus.json', JSON.stringify({ enabled: true, base_url: 'https://byteplus.test/api/v3', api_key: 'fixture-secret', video: { model: 'fixture-video', duration: 5, resolution: '720p', ratio: '9:16', generate_audio: true, watermark: false } }))
await withConfig(resolveConfig({ home, comfyUrl: 'http://127.0.0.1:1' }), async () => {
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
  await execute(process.execPath, ['check.mjs'], { cwd: root, env: { ...process.env, ELYSIUM_HOME: join(root, 'home'), ELYSIUM_SERVERS_FILE: join(root, 'absent.json') } })
})
