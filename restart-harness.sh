#!/usr/bin/env bash
# 已完成 configure-harness.sh 配置后的日常重启：直接使用当前源码和 skill。
# 启动命令 bash /Users/tom/Documents/jileshijie/llm-dsh-plugins/restart-harness.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd -P)"
HARNESS="${HARNESS_DIR:-$(dirname "$REPO")/deepseek-harness}"
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

fail() { echo "重启失败：$*" >&2; exit 1; }
for tool in node lsof ps; do
  command -v "$tool" >/dev/null 2>&1 || fail "缺少 $tool；本脚本不会安装软件。"
done
[[ -d "$HARNESS" ]] || fail "找不到 Harness：$HARNESS"
HARNESS="$(cd "$HARNESS" && pwd -P)"
[[ -f "$HARNESS/apps/cli/src/bin.ts" ]] || fail "缺少 Harness CLI 源码。"
[[ -f "$HARNESS/apps/web/dist/index.html" ]] || fail "缺少已有的 Harness Web 构建产物。"
cd "$HARNESS"

# 所有预检先于停止服务；不改 profile、不重新注册插件。
node --input-type=module - "$REPO/meiji" "$DSH_HOME" <<'NODE'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
const [major, minor] = process.versions.node.split('.').map(Number)
try {
  if (!((major === 22 && minor >= 19) || major >= 24)) throw Error('需要 Node.js ^22.19.0 或 >=24')
  import.meta.resolve('tsx/esm')
  const [plugin, home] = process.argv.slice(2)
  const profileDir = resolve(home, 'profiles/web')
  const profile = JSON.parse(readFileSync(resolve(profileDir, 'package.json'), 'utf8'))
  if (!profile.dsh?.profile?.bundles?.includes('@meiji/harness-plugin')) throw Error('web profile 尚未启用 meiji')
  if (realpathSync(resolve(profileDir, 'node_modules/@meiji/harness-plugin')) !== realpathSync(plugin)) {
    throw Error('web profile 的 meiji 未链接到当前仓库')
  }
} catch (error) {
  console.error(`重启预检失败：${error.message}。本脚本仅用于已配置好的环境，不执行安装。`)
  process.exit(1)
}
NODE

listeners() { lsof -nP -t -iTCP:3080 -sTCP:LISTEN 2>/dev/null | sort -u || true; }
pids="$(listeners)"
# 先检查所有监听者，避免只检查一部分便开始关闭。
for pid in $pids; do
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  args="$(ps -p "$pid" -o command=)"
  [[ "$cwd" == "$HARNESS" && "$args" == *'apps/cli/src/bin.ts web' ]] ||
    fail "3080 被非预期进程 PID=$pid 占用，请自行处理；未停止任何进程。"
done
for pid in $pids; do
  echo "正常停止 Harness（PID=${pid}），等待任务清理……"
  kill -TERM "$pid"
done
for pid in $pids; do
  for ((attempt = 0; attempt < 60; attempt++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    fail "PID=$pid 在 60 秒内未退出；未强制杀进程，也未启动新实例。"
  fi
done
[[ -z "$(listeners)" ]] || fail "3080 仍被占用，未启动新实例。"

node "$REPO/meiji/scripts/migrate-story-outline.js" "$DSH_HOME"

export PATH="$HARNESS/node_modules/.bin:$PATH"
echo "使用当前 meiji 代码与 skill 启动 Harness：http://127.0.0.1:3080"
echo "前台运行，按 Ctrl+C 停止；页面打开后刷新以加载新前端。"
exec node --import tsx/esm apps/cli/src/bin.ts web
