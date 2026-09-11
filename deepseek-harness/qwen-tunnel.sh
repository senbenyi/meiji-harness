#!/usr/bin/env bash
set -Eeuo pipefail

readonly HARNESS_ROOT=/workspace/harness
readonly SSH_CONFIG="$HARNESS_ROOT/config/qwen-ssh.conf"
readonly SSH_TARGET=veo-qwen38
readonly LOCAL_HOST=127.0.0.1
readonly LOCAL_PORT=18000
readonly REMOTE_HOST=127.0.0.1
readonly REMOTE_PORT=8000
readonly MODEL_ID=qwen3.8-27b-elysium
readonly PID_FILE="$HARNESS_ROOT/qwen-tunnel.pid"
readonly LOG_FILE="$HARNESS_ROOT/logs/qwen-tunnel.log"
readonly FORWARD="$LOCAL_HOST:$LOCAL_PORT:$REMOTE_HOST:$REMOTE_PORT"

fail() { echo "[FAIL] $1" >&2; exit 1; }
model_present() {
  node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { try { const data=JSON.parse(body); process.exit(data.data?.some(item => item.id === process.argv[1]) ? 0 : 1); } catch { process.exit(1); } });' "$MODEL_ID"
}
qwen_ready() {
  curl -fsS --max-time 5 "http://$LOCAL_HOST:$LOCAL_PORT/v1/models" 2>/dev/null | model_present
}
port_in_use() {
  node -e 'const net=require("node:net"); const server=net.createServer(); server.once("error", () => process.exit(0)); server.listen(Number(process.argv[1]), process.argv[2], () => server.close(() => process.exit(1)));' "$LOCAL_PORT" "$LOCAL_HOST"
}
running_pid() {
  local command_line
  [[ -s "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command_line="$(ps -p "$pid" -o args= 2>/dev/null)" || return 1
  [[ "$command_line" == *"$FORWARD"* ]] || return 1
  printf '%s\n' "$pid"
}
stop() {
  local pid
  pid="$(running_pid || true)"
  [[ -n "$pid" ]] || { rm -f "$PID_FILE"; return; }
  kill -TERM "$pid"
  for _ in {1..30}; do
    kill -0 "$pid" 2>/dev/null || { rm -f "$PID_FILE"; return; }
    sleep 1
  done
  fail "Qwen 隧道 PID $pid 未停止"
}

action="${1:-start}"
[[ "$action" == start || "$action" == --stop ]] || fail 'Usage: qwen-tunnel.sh [--stop]'
if [[ "$action" == --stop ]]; then
  stop
  exit 0
fi
for name in curl node ps ssh; do
  command -v "$name" >/dev/null || fail "缺少命令：$name"
done
[[ -s "$SSH_CONFIG" ]] || fail "缺少 Qwen SSH 配置：$SSH_CONFIG"
install -d -m 0750 "$HARNESS_ROOT/logs"
if running_pid >/dev/null && qwen_ready; then
  echo "[OK] Qwen3.8 隧道已运行：http://$LOCAL_HOST:$LOCAL_PORT/v1"
  exit 0
fi
stop
port_in_use && fail "端口 $LOCAL_PORT 被其他进程占用"
ssh -F "$SSH_CONFIG" -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" \
  "curl -fsS --max-time 5 'http://$REMOTE_HOST:$REMOTE_PORT/v1/models'" | \
  model_present || fail 'Qwen SSH 或模型 API 预检失败'
: >"$LOG_FILE"
nohup ssh -F "$SSH_CONFIG" -N -o BatchMode=yes -o ConnectTimeout=10 \
  -o ExitOnForwardFailure=yes -L "$FORWARD" "$SSH_TARGET" \
  >>"$LOG_FILE" 2>&1 </dev/null &
pid=$!
printf '%s\n' "$pid" >"$PID_FILE"
for _ in {1..30}; do
  kill -0 "$pid" 2>/dev/null || fail "Qwen 隧道已退出，查看 $LOG_FILE"
  if qwen_ready; then
    echo "[DONE] Qwen3.8 可访问：http://$LOCAL_HOST:$LOCAL_PORT/v1"
    exit 0
  fi
  sleep 1
done
fail 'Qwen3.8 隧道启动超时'
