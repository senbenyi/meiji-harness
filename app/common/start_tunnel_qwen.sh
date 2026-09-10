#!/usr/bin/env bash
set -Eeuo pipefail

# 在本机执行；连接远端 Qwen API，供本机 Harness 使用。

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly CONFIG="$REPO_ROOT/app/config/harness-settings.yaml"
[[ -s "$CONFIG" ]] || { echo "[FAIL] 缺少配置：$CONFIG" >&2; exit 1; }
runtime_settings="$("${PYTHON_BIN:-python3}" "$REPO_ROOT/app/common/config_loader.py" shell "$CONFIG")"
eval "$runtime_settings"

fail() { echo "[FAIL] $1" >&2; exit 1; }
for name in curl lsof ps ssh; do
  command -v "$name" >/dev/null 2>&1 || fail "缺少命令：$name"
done
ssh_options=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
model_present() {
  "${PYTHON_BIN:-python3}" -c 'import json,sys; target=sys.argv[1]; data=json.load(sys.stdin); raise SystemExit(0 if target in {item.get("id") for item in data.get("data", [])} else 1)' "$QWEN_MODEL_ID"
}
qwen_ready() {
  curl -fsS --max-time 5 "http://$QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT/v1/models" 2>/dev/null | \
    model_present
}

listener_pids="$(lsof -nP -tiTCP:"$QWEN_API_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true)"
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *ssh* && "$command_line" == *"$QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT:$QWEN_REMOTE_HOST:$QWEN_API_REMOTE_PORT"* ]] || \
    fail "端口 $QWEN_API_LOCAL_PORT 被其他程序占用：PID $pid"
done <<<"$listener_pids"
if [[ -n "$listener_pids" ]] && qwen_ready; then
  echo "[REUSE] Qwen3.8 可访问：http://$QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT/v1"
  exit 0
fi
ssh "${ssh_options[@]}" "$QWEN_SSH_TARGET" \
  "curl -fsS --max-time 5 'http://$QWEN_REMOTE_HOST:$QWEN_API_REMOTE_PORT/v1/models'" | \
  model_present || fail 'Qwen SSH 或模型 API 预检失败，未停止旧通道'

while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  echo "[TUNNEL] 停止旧通道：PID $pid"
  kill "$pid"
done <<<"$listener_pids"
for _ in {1..20}; do
  [[ -z "$(lsof -nP -tiTCP:"$QWEN_API_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true)" ]] && break
  sleep 0.1
done
[[ -z "$(lsof -nP -tiTCP:"$QWEN_API_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true)" ]] || \
  fail "旧通道未能释放端口 $QWEN_API_LOCAL_PORT"

echo "[TUNNEL] $QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT -> $QWEN_SSH_TARGET:$QWEN_REMOTE_HOST:$QWEN_API_REMOTE_PORT"
ssh -f -N "${ssh_options[@]}" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=20 \
  -o ServerAliveCountMax=3 \
  -L "$QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT:$QWEN_REMOTE_HOST:$QWEN_API_REMOTE_PORT" \
  "$QWEN_SSH_TARGET"

for _ in {1..20}; do
  if qwen_ready; then
    echo "[DONE] Qwen3.8 可访问：http://$QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT/v1"
    exit 0
  fi
  sleep 0.5
done
fail '通道已建立，但 Qwen3.8 模型接口验收失败'
