#!/usr/bin/env bash
set -Eeuo pipefail

# 在 Harness 服务器执行；通过 SSH 别名免交互建立后台通道。

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly CONFIG="$REPO_ROOT/config/harness-settings.yaml"
[[ -s "$CONFIG" ]] || { echo "[FAIL] 缺少配置：$CONFIG" >&2; exit 1; }
runtime_settings="$(python3 "$REPO_ROOT/scripts/common/config_loader.py" shell "$CONFIG")"
eval "$runtime_settings"

fail() { echo "[FAIL] $1" >&2; exit 1; }
for name in curl lsof ps ssh; do
  command -v "$name" >/dev/null 2>&1 || fail "缺少命令：$name"
done

listener_pids="$(lsof -nP -tiTCP:"$QWEN_API_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true)"
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *ssh* && "$command_line" == *"127.0.0.1:$QWEN_API_LOCAL_PORT:"* ]] || \
    fail "端口 $QWEN_API_LOCAL_PORT 被其他程序占用：PID $pid"
  echo "[TUNNEL] 停止旧通道：PID $pid"
  kill "$pid"
done <<<"$listener_pids"
for _ in {1..20}; do
  [[ -z "$(lsof -nP -tiTCP:"$QWEN_API_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true)" ]] && break
  sleep 0.1
done
[[ -z "$(lsof -nP -tiTCP:"$QWEN_API_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true)" ]] || \
  fail "旧通道未能释放端口 $QWEN_API_LOCAL_PORT"

echo "[TUNNEL] 127.0.0.1:$QWEN_API_LOCAL_PORT -> $QWEN_SSH_TARGET:127.0.0.1:$QWEN_API_REMOTE_PORT"
ssh -f -N \
  -F "$REPO_ROOT/config/ssh_config" \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=10 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=20 \
  -o ServerAliveCountMax=3 \
  -L "127.0.0.1:$QWEN_API_LOCAL_PORT:127.0.0.1:$QWEN_API_REMOTE_PORT" \
  "$QWEN_SSH_TARGET"

for _ in {1..20}; do
  if curl -fsS --max-time 5 "http://127.0.0.1:$QWEN_API_LOCAL_PORT/v1/models" 2>/dev/null | \
      grep -Fq "\"id\":\"$QWEN_MODEL_ID\""; then
    echo "[DONE] Qwen3.8 可访问：http://127.0.0.1:$QWEN_API_LOCAL_PORT/v1"
    exit 0
  fi
  sleep 0.5
done
fail '通道已建立，但 Qwen3.8 模型接口验收失败'
