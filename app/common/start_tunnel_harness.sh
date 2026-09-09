#!/usr/bin/env bash
set -Eeuo pipefail

# 本机浏览器入口；服务器重启后重新运行即可恢复通道。
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$("${PYTHON_BIN:-python3}" "$REPO_ROOT/app/common/config_loader.py" shell "$REPO_ROOT/app/config/harness-settings.yaml")"
eval "$runtime_settings"
target="$HARNESS_SSH_TARGET"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10)

fail() { echo "[FAIL] $1" >&2; exit 1; }
listeners() { lsof -nP -tiTCP:"$local_port" -sTCP:LISTEN 2>/dev/null || true; }
ready() { curl -fsS --connect-timeout 2 --max-time 3 "$url" >/dev/null 2>&1; }

[[ "$#" -eq 0 ]] || fail '本脚本不接受参数，端口读取 harness-settings.yaml'
for command_name in ssh curl lsof; do
  command -v "$command_name" >/dev/null || fail "缺少命令：$command_name"
done

ensure_tunnel() {
  local name="$1" local_host="$2" local_port="$3" remote_host="$4" remote_port="$5" url="$6" remote_url="$7"
  local socket="${TMPDIR:-/tmp}/elysium-harness-${UID}-${local_port}.sock"
  ssh "${ssh_options[@]}" "$target" \
    "curl -fsS --max-time 5 '$remote_url' >/dev/null" || fail "远端 $name 未就绪或 SSH 连接失败"

  # 逐个复用健康 SSH 通道；只允许关闭本脚本的专属控制连接。
  if [[ -n "$(listeners)" ]]; then
    if ready && lsof -nP -a -c ssh -iTCP:"$local_port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[OK] $name 隧道已可用：$url"
      return
    fi
    ssh -S "$socket" -O check "$target" >/dev/null 2>&1 || fail "端口 $local_port 被其他连接或程序占用"
    ssh -S "$socket" -O exit "$target"
    for _ in {1..20}; do [[ -n "$(listeners)" ]] || break; sleep 0.1; done
    [[ -z "$(listeners)" ]] || fail '旧隧道未退出'
  fi

  ssh -f -N -M -S "$socket" "${ssh_options[@]}" \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -L "$local_host:$local_port:$remote_host:$remote_port" "$target"
  for _ in {1..20}; do
    if ready; then echo "[DONE] $name 本地访问已就绪：$url"; return; fi
    sleep 0.25
  done
  fail "隧道已建立，但本地 HTTP 检查失败：$url"
}

# 仅为浏览器的回环地址建立转发；公网地址直接检查，不绑定其端口。
comfyui_forward="$("${PYTHON_BIN:-python3}" - "$MINIMAX_H3_COMFYUI_PUBLIC_URL" "$MINIMAX_H3_COMFYUI_URL" <<'PYURL'
import sys
from urllib.parse import urlsplit
public, internal = map(urlsplit, sys.argv[1:])
if public.hostname in ('127.0.0.1', 'localhost'):
    print(public.hostname, public.port or (443 if public.scheme == 'https' else 80),
          internal.hostname, internal.port or (443 if internal.scheme == 'https' else 80))
PYURL
)"
ensure_tunnel Harness "$HARNESS_LOCAL_HOST" "$HARNESS_LOCAL_PORT" "$HARNESS_HOST" "$HARNESS_WEB_PORT" \
  "http://$HARNESS_LOCAL_HOST:$HARNESS_LOCAL_PORT/" "http://$HARNESS_HOST:$HARNESS_WEB_PORT/"
if [[ -n "$comfyui_forward" ]]; then
  read -r comfyui_host comfyui_port remote_host remote_port <<< "$comfyui_forward"
  ensure_tunnel ComfyUI "$comfyui_host" "$comfyui_port" "$remote_host" "$remote_port" \
    "$MINIMAX_H3_COMFYUI_PUBLIC_URL" "$MINIMAX_H3_COMFYUI_URL"
else
  curl -fsS --connect-timeout 2 --max-time 5 "$MINIMAX_H3_COMFYUI_PUBLIC_URL" >/dev/null || fail 'ComfyUI 浏览器地址不可访问'
fi
