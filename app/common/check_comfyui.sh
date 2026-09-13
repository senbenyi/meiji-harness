#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$(bash "$REPO_ROOT/app/common/config_loader.sh" shell "$REPO_ROOT/harness/config/settings.yaml")"
eval "$runtime_settings"

fail() { echo "[FAIL] $1" >&2; exit 1; }
[[ "$#" -eq 0 ]] || fail '本脚本不接受参数'
for name in curl node; do command -v "$name" >/dev/null || fail "缺少命令：$name"; done

for path in system_stats queue; do
  curl -fsS --connect-timeout 3 --max-time 10 "$COMFYUI_URL/$path" >/dev/null || fail "RunPod ComfyUI /$path 不可访问"
done
count="$(curl -fsS --connect-timeout 3 --max-time 15 "$COMFYUI_URL/userdata?dir=workflows&recurse=true&split=false&full_info=true" \
  | node -e 'let body="";process.stdin.on("data",x=>body+=x).on("end",()=>{const names=new Set(JSON.parse(body).map(x=>x.path));const expected=["T2VA","I2VA","FL2VA","FL2VA-Loop","R2VA"].map(x=>`minimax/MiniMaxH3-Turbo-${x}-Qwen3.5.json`);console.log(expected.filter(x=>names.has(x)).length)})')"
[[ "$count" == 5 ]] || fail "RunPod 未提供完整五份 H3 工作流：$count/5"
for node in MiniMaxH3ImageToVideo MiniMaxH3ReferenceToVideo VHS_VideoCombine; do
  curl -fsS --connect-timeout 3 --max-time 15 "$COMFYUI_URL/object_info/$node" \
    | NODE_NAME="$node" node -e 'let body="";process.stdin.on("data",x=>body+=x).on("end",()=>process.exit(Object.hasOwn(JSON.parse(body),process.env.NODE_NAME)?0:1))' \
    || fail "RunPod 缺少工作流节点：$node"
done
echo "[OK] RunPod ComfyUI 与五份 H3 工作流可用：$COMFYUI_URL"
