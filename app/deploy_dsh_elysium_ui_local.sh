#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "[FAIL] $1" >&2; exit 1; }
[[ "$#" -eq 0 ]] || fail '本脚本不接受参数，仅部署本机 web profile'
for command_name in node pnpm dsh lsof ps curl; do
  command -v "$command_name" >/dev/null || fail "本机缺少命令：$command_name"
done
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
UI_ROOT="$REPO_ROOT/dsh-elysium-ui"
runtime_settings="$(python3 "$REPO_ROOT/app/common/config_loader.py" shell "$REPO_ROOT/config/harness-settings.yaml")"
eval "$runtime_settings"
export DSH_HOME="$LOCAL_DSH_HOME"
[[ "$DSH_HOME" == /* ]] || fail 'DSH_HOME 必须是绝对路径'
PORT="$LOCAL_HARNESS_PORT"
LOG_FILE="$DSH_HOME/logs/dsh-elysium-ui-local.log"
[[ -f "$UI_ROOT/package.json" ]] || fail '找不到 dsh-elysium-ui'
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || fail '需要 Node.js 20+'

listener_pids() { lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true; }
check_listener() {
  local pid command_line
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    command_line="$(ps -p "$pid" -o command=)" || fail "无法核对端口进程：$pid"
    [[ "$command_line" == *dsh* && "$command_line" == *' web '* ]] || \
      fail "端口 $PORT 被无法确认的进程占用：PID ${pid}，请先手动停止"
  done <<<"$(listener_pids)"
}

echo '[1/4] 检查本地环境'
check_listener
mkdir -p "$DSH_HOME/logs"
[[ -w "$DSH_HOME" ]] || fail "目录不可写：$DSH_HOME"

echo '[2/4] 安装依赖、测试、构建并打包 UI 插件'
(
  cd "$UI_ROOT"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm test
  pnpm build
  pnpm package:registry
)

echo '[3/4] 注册到本机 Harness web profile'
dsh plugin --profile web add --workspace-root "$UI_ROOT/registry"
node --input-type=module - "$DSH_HOME/profiles/web/package.json" <<'JS'
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const name = '@dsh-external/dsh-elysium-ui'
if (!profile.dependencies?.[name] || !profile.dsh?.profile?.bundles?.includes(name)) {
  throw new Error('UI 插件未正确注册到 web profile')
}
JS

echo '[4/4] 重启本机 Harness 并检查 HTTP'
check_listener
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  kill -TERM "$pid"
done <<<"$(listener_pids)"
for _ in {1..30}; do
  [[ -z "$(listener_pids)" ]] && break
  sleep 1
done
[[ -z "$(listener_pids)" ]] || fail "端口 $PORT 未释放，请检查已有启动管理器"
(
  cd "$REPO_ROOT"
  exec nohup dsh web --host "$LOCAL_HARNESS_HOST" --port "$PORT" --no-open
) >>"$LOG_FILE" 2>&1 </dev/null &
harness_pid=$!
for _ in {1..30}; do
  kill -0 "$harness_pid" 2>/dev/null || fail "Harness 已退出，查看日志：$LOG_FILE"
  if curl -fsS --max-time 2 "http://$LOCAL_HARNESS_HOST:$PORT/" >/dev/null 2>&1; then
    echo "[DONE] 本机 UI 插件已安装，HTTP 检查通过：http://$LOCAL_HARNESS_HOST:$PORT/"
    echo '请刷新页面，打开 设置 → 极乐世界 → 导演设置 完成界面验收'
    exit 0
  fi
  sleep 1
done
fail "Harness 启动超时，查看日志：$LOG_FILE"
