#!/usr/bin/env bash
set -Eeuo pipefail

target="${1:-veo-comfyui}"
local_port="${WAN22_HARNESS_LOCAL_PORT:-23080}"
remote_port="${WAN22_HARNESS_PORT:-3080}"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10)

listener_pids() {
  lsof -nP -tiTCP:"$local_port" -sTCP:LISTEN 2>/dev/null || true
}

web_ready() {
  curl -fsS --max-time 3 "http://127.0.0.1:$local_port" >/dev/null 2>&1
}

remote_ready() {
  ssh "${ssh_options[@]}" "$target" \
    "curl -fsS --max-time 3 'http://127.0.0.1:$remote_port' >/dev/null 2>&1"
}

release_local_port() {
  local pids remaining pid command_line
  pids="$(listener_pids)"
  [[ -n "$pids" ]] || return 0
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    [[ "$command_line" == *ssh* && "$command_line" == *"127.0.0.1:$local_port:127.0.0.1:$remote_port"* ]] || {
      echo "[FAIL] 本地端口 $local_port 被其他程序占用：PID $pid" >&2
      return 1
    }
  done <<<"$pids"
  echo "[TUNNEL] 释放本地端口 $local_port：${pids//$'\n'/,}"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done <<<"$pids"
  for _ in {1..20}; do
    [[ -n "$(listener_pids)" ]] || return 0
    sleep 0.1
  done
  remaining="$(listener_pids)"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
  done <<<"$remaining"
  [[ -z "$(listener_pids)" ]]
}

remote_ready || {
  echo "[FAIL] 远端 Harness 未就绪：$target:127.0.0.1:$remote_port" >&2
  echo "       请先在远端启动 Qwen 通道和 Harness 服务。" >&2
  echo "       ssh $target 'cd /root/autodl-tmp/project/harness && bash scripts/common/start_harness.sh'" >&2
  exit 1
}

if [[ -n "$(listener_pids)" ]] && web_ready; then
  echo "[REUSE] Harness 通道已可访问：http://127.0.0.1:$local_port"
  exit 0
fi

release_local_port || { echo "[FAIL] 无法释放本地端口：$local_port" >&2; exit 1; }
echo "[TUNNEL] http://127.0.0.1:$local_port -> $target:127.0.0.1:$remote_port"
ssh -f -N "${ssh_options[@]}" \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 \
  -L "127.0.0.1:$local_port:127.0.0.1:$remote_port" "$target"
for _ in {1..20}; do
  web_ready && {
    echo "[DONE] Harness 通道已在后台运行：http://127.0.0.1:$local_port"
    exit 0
  }
  sleep 0.25
done
echo "[FAIL] SSH 通道已建立，但本地 Harness HTTP 验收失败" >&2
exit 1
