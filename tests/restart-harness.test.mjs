import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'

const repo = resolve(import.meta.dirname, '..')
function fixture(t, { linked = true, registered = true, built = true, pid = '', foreign = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'meiji-restart-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const harness = join(root, 'harness')
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  const profile = join(home, 'profiles/web')
  for (const dir of [bin, join(harness, 'apps/cli/src'), join(harness, 'apps/web/dist'), join(harness, 'node_modules/tsx'), join(profile, 'node_modules/@meiji')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(harness, 'apps/cli/src/bin.ts'), '')
  if (built) writeFileSync(join(harness, 'apps/web/dist/index.html'), '')
  writeFileSync(join(harness, 'node_modules/tsx/package.json'), JSON.stringify({ name: 'tsx', exports: { './esm': './esm.mjs' } }))
  writeFileSync(join(harness, 'node_modules/tsx/esm.mjs'), '')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: registered ? ['@meiji/harness-plugin'] : [] } } }))
  symlinkSync(linked ? join(repo, 'meiji') : root, join(profile, 'node_modules/@meiji/harness-plugin'))
  const scripts = {
    node: '#!/bin/bash\nif [[ "$1" == --import ]]; then echo "$*" > "$TEST_LAUNCH"; exit 0; fi\nexec "$REAL_NODE" "$@"\n',
    lsof: '#!/bin/bash\nif [[ "$1" == -a ]]; then printf "p%s\\nn%s\\n" "$TEST_PID" "$TEST_CWD"; elif [[ -n "$TEST_PID" ]] && kill -0 "$TEST_PID" 2>/dev/null; then echo "$TEST_PID"; fi\n',
    ps: '#!/bin/bash\necho "node --import tsx/esm apps/cli/src/bin.ts web"\n',
  }
  for (const [name, source] of Object.entries(scripts)) writeFileSync(join(bin, name), source, { mode: 0o755 })
  const log = join(root, 'launch.log')
  return {
    log,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_NODE: process.execPath, HARNESS_DIR: harness, DSH_HOME: home, TEST_LAUNCH: log, TEST_PID: String(pid), TEST_CWD: foreign ? root : harness },
  }
}
function run(f) { return spawnSync('bash', [join(repo, 'restart-harness.sh')], { env: f.env, encoding: 'utf8' }) }

test('无服务时预检真实源码链接后直接启动，不调用安装器', t => {
  const f = fixture(t)
  const result = run(f)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(f.log, 'utf8').trim(), '--import tsx/esm apps/cli/src/bin.ts web')
})
for (const [label, options, expected] of [
  ['错误源码链接', { linked: false }, /未链接到当前仓库/],
  ['插件未启用', { registered: false }, /尚未启用 meiji/],
  ['缺少构建产物', { built: false }, /缺少已有的 Harness Web 构建产物/],
]) {
  test(`${label}在停止服务前报错`, t => {
    const f = fixture(t, { ...options, pid: process.pid })
    const result = run(f)
    assert.equal(result.status, 1)
    assert.match(result.stderr, expected)
    assert.throws(() => readFileSync(f.log), { code: 'ENOENT' })
  })
}
test('拒绝停止其他目录的端口占用者', t => {
  const f = fixture(t, { pid: process.pid, foreign: true })
  const result = run(f)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /非预期进程/)
})
test('旧服务收到 SIGTERM 并退出后才启动', async t => {
  const old = spawn('/bin/sleep', ['120'])
  t.after(() => { if (old.exitCode === null && old.signalCode === null) old.kill() })
  const exited = once(old, 'exit')
  const f = fixture(t, { pid: old.pid })
  const child = spawn('bash', [join(repo, 'restart-harness.sh')], { env: f.env })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const [status] = await once(child, 'exit')
  assert.equal(status, 0, stderr)
  assert.equal((await exited)[1], 'SIGTERM')
  assert.match(readFileSync(f.log, 'utf8'), /bin.ts web/)
})
