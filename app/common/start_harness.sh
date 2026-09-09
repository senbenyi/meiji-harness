#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly CONFIG="$REPO_ROOT/config/harness-settings.yaml"
[[ -s "$CONFIG" ]] || { echo "[FAIL] 缺少配置：$CONFIG" >&2; exit 1; }
runtime_settings="$("${PYTHON_BIN:-python3}" "$REPO_ROOT/app/common/config_loader.py" shell "$CONFIG")"
eval "$runtime_settings"

harness_root="$HARNESS_ROOT"
project_root="$PROJECT_ROOT"
node_root="$harness_root/runtime/node-v24.20.0-linux-x64"
dsh_bin="$harness_root/app/node_modules/.bin/dsh"
port="$HARNESS_WEB_PORT"
session=wan22-harness
log_file="$harness_root/logs/harness.log"
qwen_api="http://$QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT/v1"
action="${1:-start}"

fail() { echo "[FAIL] $1" >&2; exit 1; }
session_running() { screen -list 2>/dev/null | grep -q "[.]${session}[[:space:]]"; }
web_ready() { curl -fsS --max-time 2 "http://$HARNESS_HOST:$port" >/dev/null 2>&1; }
qwen_ready() {
  curl -fsS --max-time 5 "$qwen_api/models" 2>/dev/null | \
    grep -Fq "\"id\":\"$QWEN_MODEL_ID\""
}

ensure_qwen() {
  qwen_ready && return 0
  echo '[TUNNEL] Qwen3.8 API 不可用，自动建立通道'
  bash "$SCRIPT_DIR/start_tunnel_qwen.sh" || fail 'Qwen 通道建立失败'
  qwen_ready || fail '通道已建立，但 Qwen3.8 API 仍不可用'
}

stop_session() {
  session_running || return 0
  screen -S "$session" -X quit
  for _ in {1..30}; do session_running || return 0; sleep 1; done
  fail "$session 未停止"
}

case "$action" in
  start) ;;
  --restart) ;;
  --stop)
    stop_session
    for _ in {1..10}; do
      web_ready || { echo '[DONE] Harness 已停止'; exit 0; }
      sleep 1
    done
    fail "端口 $port 仍有服务运行"
    ;;
  -h|--help) echo 'Usage: start_harness.sh [--restart|--stop]'; exit 0 ;;
  *) fail "不支持的参数：$action" ;;
esac
[[ "$#" -le 1 ]] || fail '只支持一个参数'

if web_ready; then
  session_running || fail "端口 $port 已被其他服务占用"
  if [[ "$action" == start ]]; then
    ensure_qwen
    echo "[OK] Harness 与 Qwen3.8 均已运行：http://$HARNESS_HOST:$port"
    exit 0
  fi
fi
[[ -x "$node_root/bin/node" && -x "$dsh_bin" ]] || \
  fail 'Harness 尚未部署，请先执行 deploy_harness.sh'
[[ -d "$project_root" ]] || fail "对话工作目录不存在：$project_root"
ensure_qwen
"${PYTHON_BIN:-python3}" "$REPO_ROOT/app/common/config_loader.py" check "$CONFIG" --harness-root "$harness_root"
stop_session
"${PYTHON_BIN:-python3}" "$REPO_ROOT/app/common/config_loader.py" apply "$CONFIG" --harness-root "$harness_root"
install -d -m 0750 "$harness_root/logs" "$harness_root/tmp"
: > "$log_file"

(
  cd "$project_root"
  screen -L -Logfile "$log_file" -dmS "$session" \
    env PATH="$node_root/bin:$PATH" \
      DSH_HOME="$harness_root/home" \
      DSH_PERMISSION_MODE="$DSH_PERMISSION_MODE" \
      QWEN38_LOCAL_API_KEY=local-vllm \
      MINIMAX_H3_COMFYUI_URL="$MINIMAX_H3_COMFYUI_URL" \
      MINIMAX_H3_COMFYUI_PUBLIC_URL="$MINIMAX_H3_COMFYUI_PUBLIC_URL" \
      MINIMAX_H3_COMFYUI_OUTPUT_ROOT="$MINIMAX_H3_COMFYUI_OUTPUT_ROOT" \
      ARTIFACTS_ROOT="$ARTIFACTS_ROOT" \
      ELYSIUM_TOOLS_STATE_ROOT="$ELYSIUM_TOOLS_STATE_ROOT" \
      HARNESS_PYTHON="$HARNESS_PYTHON" \
      LLM_AI_MODEL_ROOT="$LLM_AI_MODEL_ROOT" \
      ELYSIUM_WORKSPACE="$harness_root/data/elysium" \
      ELYSIUM_SHARED_INPUT_ROOT="$COMFYUI_INPUT_ROOT" \
      npm_config_cache="$harness_root/cache/npm" \
      TMPDIR="$harness_root/tmp" \
      "$dsh_bin" web --host "$HARNESS_HOST" --port "$port" --no-open
)

for _ in {1..60}; do
  web_ready && { echo "[DONE] Harness 已就绪：http://$HARNESS_HOST:$port"; exit 0; }
  session_running || fail "Harness 已退出；查看 $log_file"
  sleep 2
done
fail "Harness 启动超时；查看 $log_file"
