#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$("${PYTHON_BIN:-python3}" "$REPO_ROOT/app/common/config_loader.py" shell "$REPO_ROOT/app/config/harness-settings.yaml")"
eval "$runtime_settings"
target="$COMFYUI_SSH_TARGET"

fail() { echo "[FAIL] $1" >&2; exit 1; }
[[ "$#" -eq 0 ]] || fail '本脚本不接受参数'
for command_name in ssh curl lsof; do command -v "$command_name" >/dev/null || fail "缺少命令：$command_name"; done

read -r local_host local_port remote_host remote_port <<<"$("${PYTHON_BIN:-python3}" - "$MINIMAX_H3_COMFYUI_PUBLIC_URL" "$MINIMAX_H3_COMFYUI_URL" <<'PY'
import sys
from urllib.parse import urlsplit
public, internal = map(urlsplit, sys.argv[1:])
if public.hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('公网 ComfyUI 地址无需 SSH 隧道')
print(public.hostname, public.port or (443 if public.scheme == 'https' else 80),
      internal.hostname, internal.port or (443 if internal.scheme == 'https' else 80))
PY
)"
url="$MINIMAX_H3_COMFYUI_PUBLIC_URL"
remote_url="$MINIMAX_H3_COMFYUI_URL"
socket="${TMPDIR:-/tmp}/elysium-comfyui-${UID}-${local_port}.sock"
listeners() { lsof -nP -tiTCP:"$local_port" -sTCP:LISTEN 2>/dev/null || true; }
ready() { curl -fsS --connect-timeout 2 --max-time 5 "$url/queue" >/dev/null 2>&1; }

ssh -o BatchMode=yes -o ConnectTimeout=10 "$target" \
  "curl -fsS --max-time 5 '$remote_url/queue' >/dev/null" || fail '远端 ComfyUI 未就绪或 SSH 连接失败'
if [[ -n "$(listeners)" ]]; then
  if ready && lsof -nP -a -c ssh -iTCP:"$local_port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[OK] ComfyUI 隧道已可用：$url"
    exit 0
  fi
  ssh -S "$socket" -O check "$target" >/dev/null 2>&1 || fail "端口 $local_port 被其他连接或程序占用"
  ssh -S "$socket" -O exit "$target"
  for _ in {1..20}; do [[ -z "$(listeners)" ]] && break; sleep 0.1; done
  [[ -z "$(listeners)" ]] || fail '旧 ComfyUI 隧道未退出'
fi
ssh -f -N -M -S "$socket" -o BatchMode=yes -o ConnectTimeout=10 -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  -L "$local_host:$local_port:$remote_host:$remote_port" "$target"
for _ in {1..20}; do
  if ready; then echo "[DONE] ComfyUI 本地访问已就绪：$url"; exit 0; fi
  sleep 0.25
done
fail "隧道已建立，但 ComfyUI HTTP 检查失败：$url"
