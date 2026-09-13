#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$(bash "$REPO_ROOT/app/common/config_loader.sh" shell "$REPO_ROOT/harness/config/settings.yaml")"
eval "$runtime_settings"
export DSH_HOME="$LOCAL_DSH_HOME"
export DSH_AGENTS_HOME="$DSH_HOME/agents"
export COMFYUI_URL
port="$LOCAL_HARNESS_PORT"
log_file="$DSH_HOME/logs/harness-local.log"
action="${1:-start}"

fail() { echo "[FAIL] $1" >&2; exit 1; }
listeners() { lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true; }
web_ready() {
  local code
  code="$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "http://$LOCAL_HARNESS_HOST:$port/" 2>/dev/null || true)"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ ]]
}
check_listeners() {
  local pid command_line
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    [[ "$command_line" == *dsh* && "$command_line" == *' web'* ]] || fail "端口 $port 被未知进程占用：PID $pid"
  done <<<"$(listeners)"
}
stop_harness() {
  check_listeners
  while IFS= read -r pid; do [[ -z "$pid" ]] || kill -TERM "$pid"; done <<<"$(listeners)"
  for _ in {1..30}; do [[ -z "$(listeners)" ]] && return; sleep 1; done
  fail "本机 Harness 端口 $port 未释放"
}

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
check_listeners
if web_ready && [[ "$action" == start ]]; then
  echo "[OK] 本机 Harness 已运行：http://$LOCAL_HARNESS_HOST:$port/"
  exit 0
fi
bash "$REPO_ROOT/app/common/start_tunnel_qwen.sh"
if [[ "${SKIP_COMFYUI_CHECK:-}" != 1 ]]; then
  bash "$REPO_ROOT/app/common/check_comfyui.sh"
fi
if [[ "$action" == start && -n "$(listeners)" ]]; then
  for _ in {1..30}; do
    if web_ready; then echo "[OK] 本机 Harness 与模型服务均已运行：http://$LOCAL_HARNESS_HOST:$port/"; exit 0; fi
    sleep 1
  done
  fail "本机 Harness 已监听但 HTTP 未就绪，查看 $log_file"
fi
[[ "$action" != --restart ]] || stop_harness
mkdir -p "$DSH_HOME/logs"
nohup env QWEN38_LOCAL_API_KEY=local-vllm dsh --profile web --host "$LOCAL_HARNESS_HOST" --port "$port" --no-open \
  >>"$log_file" 2>&1 </dev/null &
harness_pid=$!
for _ in {1..30}; do
  kill -0 "$harness_pid" 2>/dev/null || fail "本机 Harness 已退出，查看 $log_file"
  if web_ready; then echo "[DONE] 本机 Harness 已就绪：http://$LOCAL_HARNESS_HOST:$port/"; exit 0; fi
  sleep 1
done
fail "本机 Harness 启动超时，查看 $log_file"
