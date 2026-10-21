#!/usr/bin/env bash
# 将选定的 projects/<项目> 链接到并列 DeepSeek Harness，并启动 Web。
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
source "$REPO/scripts/project-path.sh"
PROJECT="$(select_project "$REPO" "${1:-${AGENT_PROJECT:-}}")"
PLUGIN="$REPO/projects/$PROJECT"
ROOT="$(cd "$REPO/.." && pwd)"
HARNESS="${HARNESS_DIR:-$ROOT/deepseek-harness}"
HARNESS_URL="https://github.com/deepseek-ai/deepseek-harness.git"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js ^22.19.0 或 >=24" >&2
  exit 1
fi
node -e '
const [major, minor] = process.versions.node.split(".").map(Number)
const ok = (major === 22 && minor >= 19) || major >= 24
if (!ok) {
  console.error("需要 Node.js ^22.19.0 或 >=24，当前 " + process.versions.node)
  process.exit(1)
}
'

if [[ ! -f "$PLUGIN/package.json" ]]; then
  echo "找不到项目插件: $PLUGIN" >&2
  exit 1
fi

# bundle 和预设补丁由插件源码维护，配置脚本只链接，不覆盖它们。
[[ -f "$PLUGIN/cordis.patch.yml" ]] || { echo "缺少项目预设补丁" >&2; exit 1; }
node - "$PLUGIN" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const directory = process.argv[2]
const project = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
const entry = project.exports?.['./session']
if (typeof entry !== 'string' || !entry.startsWith('./') || !fs.existsSync(path.resolve(directory, entry)) || !fs.statSync(path.resolve(directory, entry)).isFile()) {
  console.error('缺少项目预设入口：请在package.json的exports["./session"]声明文件')
  process.exit(1)
}
NODE

if [[ ! -f "$REPO/node_modules/.package-lock.json" ]]; then
  echo "安装 Agent Harness 工作区依赖"
  npm ci --prefix "$REPO"
fi

if [[ ! -d "$HARNESS/.git" ]]; then
  echo "克隆 DeepSeek Harness 到 $HARNESS"
  git clone "$HARNESS_URL" "$HARNESS"
fi

cd "$HARNESS"
if [[ ! -x node_modules/.bin/pnpm ]]; then
  echo "安装 Harness 依赖"
  npx --yes pnpm@11.7.0 install
fi
if [[ ! -d apps/web/dist ]]; then
  echo "构建 Harness"
  node_modules/.bin/pnpm run build
fi

export PATH="$HARNESS/node_modules/.bin:$PATH"
echo "链接项目插件：$PROJECT"
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add "$PLUGIN"

if node -e 'const n=require("net").connect(3080,"127.0.0.1",()=>{n.end();process.exit(0)});n.on("error",()=>process.exit(1))'; then
  echo "Harness 已在 http://127.0.0.1:3080 运行"
  exit 0
fi

# 新运行时拒绝旧项目格式，不在配置或启动时迁移用户数据。


echo "启动 Harness"
exec node --import tsx/esm apps/cli/src/bin.ts web
