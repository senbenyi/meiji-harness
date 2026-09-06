#!/usr/bin/env bash
set -Eeuo pipefail

# 本机浏览器入口；服务器重启后重新运行即可恢复通道。
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$(python3 "$REPO_ROOT/scripts/common/config_loader.py" shell "$REPO_ROOT/config/harness-settings.yaml")"
eval "$runtime_settings"
target=veo-comfyui
forward="127.0.0.1:$HARNESS_LOCAL_PORT:127.0.0.1:$HARNESS_WEB_PORT"
url="http://127.0.0.1:$HARNESS_LOCAL_PORT/"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10)
socket="${TMPDIR:-/tmp}/elysium-harness-${UID}-${HARNESS_LOCAL_PORT}.sock"

fail() { echo "[FAIL] $1" >&2; exit 1; }
listeners() { lsof -nP -tiTCP:"$HARNESS_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true; }
ready() { curl -fsS --connect-timeout 2 --max-time 3 "$url" >/dev/null 2>&1; }

[[ "$#" -eq 0 ]] || fail '本脚本不接受参数，端口读取 harness-settings.yaml'
for command_name in ssh curl lsof; do
  command -v "$command_name" >/dev/null || fail "缺少命令：$command_name"
done
ssh "${ssh_options[@]}" "$target" \
  "curl -fsS --max-time 5 'http://127.0.0.1:$HARNESS_WEB_PORT/' >/dev/null" || fail '远端 Harness 未就绪或 SSH 连接失败'

# 使用专属 SSH 控制连接识别并复用通道，不依赖读取系统进程参数。
if [[ -n "$(listeners)" ]]; then
  # 兼容已有 SSH 隧道；端口健康时无需重建连接。
  if ready && lsof -nP -a -c ssh -iTCP:"$HARNESS_LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[OK] Harness 隧道已可用：$url"
    exit 0
  fi
  ssh -S "$socket" -O check "$target" >/dev/null 2>&1 || \
    fail "端口 $HARNESS_LOCAL_PORT 被其他连接或程序占用"
  ssh -S "$socket" -O exit "$target"
  for _ in {1..20}; do [[ -n "$(listeners)" ]] || break; sleep 0.1; done
  [[ -z "$(listeners)" ]] || fail '旧隧道未退出'
fi

ssh -f -N -M -S "$socket" "${ssh_options[@]}" \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  -L "$forward" "$target"
for _ in {1..20}; do
  if ready; then echo "[DONE] Harness 本地访问已就绪：$url"; exit 0; fi
  sleep 0.25
done
fail "隧道已建立，但本地 HTTP 检查失败：$url"
