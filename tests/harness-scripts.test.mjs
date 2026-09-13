import assert from 'node:assert/strict'
import { chmod, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const source = new URL('../', import.meta.url).pathname
const shell = (path, env, args = []) => spawnSync('bash', [path, ...args], { env, encoding: 'utf8' })
async function executable(path, body) { await writeFile(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`); await chmod(path, 0o755) }
async function fixture(script) {
  const root = await mkdtemp(join(tmpdir(), 'elysium-script-')), bin = join(root, 'bin')
  await mkdir(join(root, 'app/common'), { recursive: true }); await mkdir(join(root, 'harness/config'), { recursive: true }); await mkdir(bin)
  for (const name of [script, 'config_loader.sh']) await cp(join(source, 'app/common', name), join(root, 'app/common', name))
  let settings = await readFile(join(source, 'harness/config/settings.yaml'), 'utf8')
  settings = settings.replace(/^  LOCAL_DSH_HOME:.*$/m, `  LOCAL_DSH_HOME: ${root}/home`)
  await writeFile(join(root, 'harness/config/settings.yaml'), settings)
  return { root, bin, script: join(root, 'app/common', script), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
}

test('ComfyUI check validates HTTP, five workflows and required nodes without SSH', async () => {
  const item = await fixture('check_comfyui.sh'), log = join(item.root, 'curl.log')
  item.env.CHECK_LOG = log
  await executable(join(item.bin, 'curl'), `echo "curl $*" >> "$CHECK_LOG"
case "$*" in
  *userdata*) printf '%s' '[{"path":"minimax/MiniMaxH3-Turbo-T2VA-Qwen3.5.json"},{"path":"minimax/MiniMaxH3-Turbo-I2VA-Qwen3.5.json"},{"path":"minimax/MiniMaxH3-Turbo-FL2VA-Qwen3.5.json"},{"path":"minimax/MiniMaxH3-Turbo-FL2VA-Loop-Qwen3.5.json"},{"path":"minimax/MiniMaxH3-Turbo-R2VA-Qwen3.5.json"}]' ;;
  *object_info*) node_name="${'$'}{!#}"; node_name="${'$'}{node_name##*/}"; printf '{"%s":{}}' "$node_name" ;;
esac`)
  const result = shell(item.script, item.env)
  assert.equal(result.status, 0, result.stderr)
  const calls = await readFile(log, 'utf8')
  for (const path of ['/system_stats', '/queue', '/userdata', '/object_info/MiniMaxH3ImageToVideo']) assert.match(calls, new RegExp(path))
  assert.doesNotMatch(calls, /ssh|AILab_QwenVL/)
})

test('Qwen tunnel reuses a healthy model endpoint', async () => {
  const item = await fixture('start_tunnel_qwen.sh')
  await executable(join(item.bin, 'curl'), `printf '%s\n' '{"data":[{"id":"qwen3.8-27b-elysium"}]}'`)
  await executable(join(item.bin, 'lsof'), `printf '42\n'`)
  await executable(join(item.bin, 'ps'), `printf '%s\n' 'ssh -L 127.0.0.1:18000:127.0.0.1:8000 veo-qwen38'`)
  await executable(join(item.bin, 'ssh'), 'exit 99')
  const result = shell(item.script, item.env)
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /\[REUSE\]/)
})

test('local plugin deploy installs every project config from a clean home and refreshes managed presets', async () => {
  const item = await fixture('deploy_plugin.sh'), log = join(item.root, 'commands.log'), pkg = join(item.root, 'dsh-elysium-tools')
  item.env.DEPLOY_TEST_LOG = log
  await mkdir(pkg); await writeFile(join(pkg, 'package.json'), '{}')
  const base = join(item.root, 'harness/.agent-presets/_base'); await mkdir(base, { recursive: true }); await writeFile(join(base, 'agent.cordis.yml'), 'shared\n')
  for (const preset of ['elysium-standard', 'elysium-teaching', 'elysium-free', 'elysium-director']) await mkdir(join(item.root, `harness/.agent-presets/${preset}`), { recursive: true })
  await writeFile(join(item.root, 'harness/.agent-presets/elysium-standard/agent.cordis.yml'), 'standard\n')
  for (const preset of ['elysium-teaching', 'elysium-free', 'elysium-director']) await symlink('../_base/agent.cordis.yml', join(item.root, `harness/.agent-presets/${preset}/agent.cordis.yml`))
  await executable(join(item.bin, 'pnpm'), `echo "pnpm $PWD $*" >> "$DEPLOY_TEST_LOG"; [[ "${'$'}{FAIL_TESTS:-}" != 1 || "$1" != test ]]`)
  await executable(join(item.bin, 'dsh'), `echo "dsh $*" >> "$DEPLOY_TEST_LOG"; mkdir -p "${item.root}/home/profiles/web"; printf '%s' '{"dependencies":{"@dsh-external/dsh-elysium-tools":"link:x"},"dsh":{"profile":{"bundles":["@dsh-external/dsh-elysium-tools"]}}}' > "${item.root}/home/profiles/web/package.json"`)
  const result = shell(item.script, item.env, ['tools'])
  assert.equal(result.status, 0, result.stderr)
  const calls = await readFile(log, 'utf8'); assert.match(calls, /pnpm .* test/); assert.match(calls, /--workspace-root .*registry/); assert.doesNotMatch(calls, /ssh|rsync|start_harness/)
  const settings = await readFile(join(item.root, 'home/settings.yaml'), 'utf8'), profile = await readFile(join(item.root, 'home/profiles/web/cordis.patch.yml'), 'utf8')
  assert.match(settings, /agent-default-model:/); assert.doesNotMatch(settings, /harness-runtime:|harness-customization:|__QWEN_/)
  assert.match(profile, /id: command-feedback/); assert.match(profile, /comfyUrl: https:\/\//); assert.doesNotMatch(profile, /publicUrl|__COMFYUI_URL__/)
  assert.equal(await readFile(join(item.root, 'home/.agent-presets/elysium-standard/agent.cordis.yml'), 'utf8'), 'standard\n')
  assert.equal(await readFile(join(item.root, 'home/.agent-presets/elysium-teaching/agent.cordis.yml'), 'utf8'), 'shared\n')
  await writeFile(join(item.root, 'home/.agent-presets/elysium-standard/agent.cordis.yml'), 'stale\n')
  await mkdir(join(item.root, 'home/.agent-presets/custom')); await writeFile(join(item.root, 'home/.agent-presets/custom/keep'), 'keep\n')
  const repeated = shell(item.script, item.env, ['tools'])
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.equal(await readFile(join(item.root, 'home/.agent-presets/elysium-standard/agent.cordis.yml'), 'utf8'), 'standard\n')
  assert.equal(await readFile(join(item.root, 'home/.agent-presets/custom/keep'), 'utf8'), 'keep\n')
  item.env.FAIL_TESTS = '1'; await writeFile(log, '')
  const failed = shell(item.script, item.env, ['tools']); assert.notEqual(failed.status, 0); assert.doesNotMatch(await readFile(log, 'utf8'), / build|dsh plugin/)
})
