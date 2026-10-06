import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
const harness = process.env.HARNESS_DIR || fileURLToPath(new URL('../../../deepseek-harness/', import.meta.url))
test('实际 Harness 预设挂载隔离工具与 skill，全局无 meiji 工具', async t => {
  const home = await mkdtemp(resolve(tmpdir(), 'meiji-preset-')); t.after(() => rm(home, { recursive: true, force: true }))
  const tsx = createRequire(resolve(harness, 'package.json')).resolve('tsx/esm')
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', tsx, fileURLToPath(new URL('fixtures/preset-runtime-check.mjs', import.meta.url)), harness], { cwd: harness, env: { ...process.env, DSH_HOME: home }, timeout: 30000 })
  assert.equal(JSON.parse(stdout.trim()).skillIsolated, true)
})
test('预设补丁复制 compaction 组并设默认 meiji，不由配置脚本覆盖', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), standard = await readFile(resolve(harness, 'packages/bundle/web-app/presets/standard.patch.yml'), 'utf8')
  const begin = standard.indexOf('          - id: compaction\n'), end = standard.indexOf('          - id: delegation\n')
  assert.ok(patch.includes(standard.slice(begin, end))); assert.match(patch, /default: meiji/); assert.doesNotMatch(patch, /complete:/)
  const index = await readFile(new URL('../index.js', import.meta.url), 'utf8'), configure = await readFile(new URL('../../configure-harness.sh', import.meta.url), 'utf8')
  assert.match(index, /ctx.provide\('meiji'/); assert.doesNotMatch(index, /tools.register/); assert.doesNotMatch(configure, /cat > .*cordis.patch.yml/)
})

test('真实 Harness goal/todo/job 支持仅审核一项和生成审核两项，目标完成或失败后不续跑', async t => {
  const home = await mkdtemp(resolve(tmpdir(), 'meiji-step-goal-')); t.after(() => rm(home, { recursive: true, force: true }))
  const tsx = createRequire(resolve(harness, 'package.json')).resolve('tsx/esm')
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', tsx, fileURLToPath(new URL('fixtures/session-steps-runtime-check.mjs', import.meta.url)), harness], { cwd: harness, env: { ...process.env, DSH_HOME: home }, timeout: 30000 })
  const result = JSON.parse(stdout.trim())
  assert.deepEqual(result.scenarios.map(item => item.steps), [1, 2, 1])
  assert.deepEqual(result.scenarios.map(item => item.goal), ['complete', 'complete', 'blocked'])
})
