#!/usr/bin/env bash
set -Eeuo pipefail

# 职责：启动、复用、重启或停止本机 Harness，并在启动前准备模型服务。
# 输入：无参数表示启动；支持 --restart、--stop、-h 和 --help。
# 流程：读取配置 → 校验动作 → 识别监听器 → 准备模型服务 → 管理 Harness → 验收 HTTP。

# 1. 读取本机 Harness 和模型服务配置。
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$(bash "$REPO_ROOT/app/common/config_loader.sh" shell "$REPO_ROOT/harness/config/settings.yaml")"
eval "$runtime_settings"
export DSH_HOME="$LOCAL_DSH_HOME"
export DSH_AGENTS_HOME="$DSH_HOME/agents"
export COMFYUI_URL
port="$LOCAL_HARNESS_PORT"
log_file="$DSH_HOME/logs/harness-local.log"
action="${1:-start}"

# 输出统一错误并终止 Harness 管理流程。
fail() { echo "[FAIL] $1" >&2; exit 1; }

# 返回占用 Harness 端口的监听进程 PID；无监听器时返回空结果。
listeners() { lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true; }

# 只要 Harness HTTP 端点返回合法状态码，即认为 Web 服务已响应。
web_ready() {
  local code
  code="$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "http://$LOCAL_HARNESS_HOST:$port/" 2>/dev/null || true)"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ ]]
}

# 确认端口仅由 dsh web 占用，避免误停其他进程。
check_listeners() {
  local pid command_line
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    [[ "$command_line" == *dsh* && "$command_line" == *' web'* ]] || fail "端口 $port 被未知进程占用：PID $pid"
  done <<<"$(listeners)"
}

# 向已确认的 Harness 监听进程发送 TERM，并等待端口释放。
stop_harness() {
  check_listeners
  while IFS= read -r pid; do
    [[ -z "$pid" ]] || kill -TERM "$pid"
  done <<<"$(listeners)"
  for _ in {1..30}; do
    [[ -z "$(listeners)" ]] && return
    sleep 1
  done
  fail "本机 Harness 端口 $port 未释放"
}

# 2. 校验动作参数；停止动作在此直接完成。
[[ "$#" -le 1 ]] || fail '只支持一个参数'
case "$action" in
  start|--restart|--stop) ;;
  -h|--help) echo 'Usage: start_harness.sh [--restart|--stop]'; exit 0 ;;
  *) fail "不支持的参数：$action" ;;
esac
if [[ "$action" == --stop ]]; then
  stop_harness
  echo '[DONE] 本机 Harness 已停止'
  exit 0
fi

# 3. 复用已健康运行的 Harness，否则先准备 Qwen 与 ComfyUI。
check_listeners
if web_ready && [[ "$action" == start ]]; then
  echo "[OK] 本机 Harness 已运行：http://$LOCAL_HARNESS_HOST:$port/"
  exit 0
fi
bash "$REPO_ROOT/app/common/start_tunnel_qwen.sh"
if [[ "${SKIP_COMFYUI_CHECK:-}" != 1 ]]; then
  bash "$REPO_ROOT/app/common/check_comfyui.sh"
fi

# 4. 若端口已监听但 HTTP 尚未就绪，等待现有 Harness 完成启动。
if [[ "$action" == start && -n "$(listeners)" ]]; then
  for _ in {1..30}; do
    if web_ready; then
      echo "[OK] 本机 Harness 与模型服务均已运行：http://$LOCAL_HARNESS_HOST:$port/"
      exit 0
    fi
    sleep 1
  done
  fail "本机 Harness 已监听但 HTTP 未就绪，查看 $log_file"
fi

# 5. restart 先停止旧实例，再后台启动新实例并等待 HTTP 就绪。
[[ "$action" != --restart ]] || stop_harness
mkdir -p "$DSH_HOME/logs"
nohup env QWEN38_LOCAL_API_KEY=local-vllm dsh --profile web --host "$LOCAL_HARNESS_HOST" --port "$port" --no-open \
  >>"$log_file" 2>&1 </dev/null &
harness_pid=$!
for _ in {1..30}; do
  kill -0 "$harness_pid" 2>/dev/null || fail "本机 Harness 已退出，查看 $log_file"
  if web_ready; then
    echo "[DONE] 本机 Harness 已就绪：http://$LOCAL_HARNESS_HOST:$port/"
    exit 0
  fi
  sleep 1
done
fail "本机 Harness 启动超时，查看 $log_file"
