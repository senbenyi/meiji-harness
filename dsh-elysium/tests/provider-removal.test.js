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
