#!/usr/bin/env node

// 职责：从当前工作树部署香港 Harness、Elysium 插件与默认 Skill。
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dryRun = process.argv.includes('--dry-run')
if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('仅支持 --dry-run')

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: repo, input, stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码 ${result.status}`)
}
const remote = script => run('ssh', ['-o', 'BatchMode=yes', 'veo-hk', 'bash -se'], script)

const preflight = `set -euo pipefail
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
for command in rsync tar curl sha256sum lsof diff; do command -v "$command" >/dev/null || { echo "香港缺少 $command" >&2; exit 1; }; done
for endpoint in http://127.0.0.1:26016/system_stats http://127.0.0.1:28000/v1/models; do
  curl -fsS -o /dev/null --max-time 10 "$endpoint" || { echo "香港模型端口不可用：$endpoint" >&2; exit 1; }
done
echo '香港 SSH、工具和两个模型端口检查通过'
`

const bootstrap = `set -euo pipefail
mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
if ! test -x "$HOME/.local/opt/node/bin/node"; then
  archive=node-v22.22.1-linux-x64.tar.xz
  temporary=$(mktemp -d)
  trap 'rm -rf "$temporary"' EXIT
  curl -fsSL "https://nodejs.org/dist/v22.22.1/$archive" -o "$temporary/$archive"
  curl -fsSL https://nodejs.org/dist/v22.22.1/SHASUMS256.txt -o "$temporary/SHASUMS256.txt"
  (cd "$temporary" && grep " $archive$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$temporary/$archive" -C "$HOME/.local/opt"
  ln -sfn "$HOME/.local/opt/node-v22.22.1-linux-x64" "$HOME/.local/opt/node"
fi
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$HOME/.local/share/pnpm:$PATH"
if ! command -v pnpm >/dev/null; then npm install --global --prefix "$HOME/.local" pnpm@9.12.3; fi
node --version
pnpm --version
`

const seed = `import { existsSync, mkdirSync, readFileSync, writeFileSync } from './dsh-elysium/src/database/files.js'
import { validateSettings } from './dsh-elysium/src/database/managers/settings.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const path = join(homedir(), '.dsh/storages/elysium/config/settings.json')
const chatUrl = 'http://127.0.0.1:28000/v1'
const comfyUrl = 'http://127.0.0.1:26016'
if (existsSync(path)) {
  const current = validateSettings(JSON.parse(readFileSync(path, 'utf8')))
  const comfy = current.connections.servers.find(server => server.id === 'autodl-comfyui')?.services.comfyui?.base_url
  if (current.chat.backend.base_url !== chatUrl || comfy !== comfyUrl) throw new Error('香港已有不同的 Elysium 模型配置，停止部署以免覆盖')
} else {
  const settings = JSON.parse(readFileSync('./dsh-elysium/config/defaults.json', 'utf8'))
  settings.chat.backend.base_url = chatUrl
  settings.connections.servers = [{
    id: 'autodl-comfyui', label: 'veo-comfyui · RealVisXL / MiniMax H3', provider: 'autodl', connection_source: 'manual',
    instance_id: 'veo-comfyui', deployment_id: 'minimax-h3',
    services: { comfyui: { transport: 'http', base_url: comfyUrl, workload: 'minimax-h3' } },
  }]
  settings.selection.selected = { image: 'autodl-comfyui', video: 'autodl-comfyui' }
  validateSettings(settings)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 })
}
console.log('香港 Elysium 模型地址已校验')
`

console.log('目标：veo-hk；香港工作树：~/llm-dsh-plugins；运行数据：~/.dsh/storages/elysium')
if (dryRun) {
  console.log('将检查香港回环模型端口、安装 Node/pnpm、同步 harness 与 dsh-elysium、安装默认 Skill 和插件、启动回环 Harness。')
  process.exit(0)
}
remote(preflight)
remote('set -euo pipefail\nmkdir -p "$HOME/llm-dsh-plugins"\n')
run('rsync', ['-az', '--exclude=node_modules', '--exclude=lib', '--exclude=registry', '--exclude=.credentials.yaml', '--exclude=.env', 'harness', 'dsh-elysium', 'veo-hk:llm-dsh-plugins/'])
remote(bootstrap)
remote(`set -euo pipefail
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$HOME/.local/share/pnpm:$PATH"
export PNPM_HOME="$HOME/.local/share/pnpm"
cd "$HOME/llm-dsh-plugins"
DSH_INSTALL_ENV=hk node harness/scripts/install.mjs
node --input-type=module - <<'SEED'
${seed}SEED
DSH_NO_OPEN=1 DSH_BIND_HOST=127.0.0.1 node harness/scripts/start.mjs
`)
console.log('浏览器访问：先运行 ssh -N -L 3080:127.0.0.1:3080 veo-hk，再打开 http://127.0.0.1:3080/')
