#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$("${PYTHON_BIN:-python3}" "$REPO_ROOT/app/common/config_loader.py" shell "$REPO_ROOT/app/config/harness-settings.yaml")"
eval "$runtime_settings"

fail() { echo "[FAIL] $1" >&2; exit 1; }
[[ "$#" -eq 0 ]] || fail '本脚本不接受参数'
command -v curl >/dev/null || fail '缺少命令：curl'

for path in system_stats queue; do
  curl -fsS --connect-timeout 3 --max-time 10 "$COMFYUI_URL/$path" >/dev/null || fail "RunPod ComfyUI /$path 不可访问"
done
count="$(curl -fsS --connect-timeout 3 --max-time 15 "$COMFYUI_URL/userdata?dir=workflows&recurse=true&split=false&full_info=true" \
  | "${PYTHON_BIN:-python3}" -c 'import json,sys; names={x["path"] for x in json.load(sys.stdin)}; expected={"minimax/MiniMaxH3-Turbo-T2VA-Qwen3.5.json","minimax/MiniMaxH3-Turbo-I2VA-Qwen3.5.json","minimax/MiniMaxH3-Turbo-FL2VA-Qwen3.5.json","minimax/MiniMaxH3-Turbo-FL2VA-Loop-Qwen3.5.json","minimax/MiniMaxH3-Turbo-R2VA-Qwen3.5.json"}; print(len(expected & names))')"
[[ "$count" == 5 ]] || fail "RunPod 未提供完整五份 H3 工作流：$count/5"
for node in MiniMaxH3ImageToVideo MiniMaxH3ReferenceToVideo VHS_VideoCombine; do
  curl -fsS --connect-timeout 3 --max-time 15 "$COMFYUI_URL/object_info/$node" \
    | NODE_NAME="$node" "${PYTHON_BIN:-python3}" -c 'import json,os,sys; data=json.load(sys.stdin); raise SystemExit(0 if os.environ["NODE_NAME"] in data else 1)' \
    || fail "RunPod 缺少工作流节点：$node"
done
echo "[OK] RunPod ComfyUI 与五份 H3 工作流可用：$COMFYUI_URL"
