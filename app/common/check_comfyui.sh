#!/usr/bin/env bash
set -Eeuo pipefail

# 职责：验证配置中的 ComfyUI 服务、五套 MiniMax H3 工作流及其必需节点。
# 输入：不接受参数；服务地址由 harness/config/settings.yaml 提供。
# 流程：读取配置 → 检查依赖 → 检查基础接口 → 检查工作流 → 检查节点。

# 输出统一错误并终止检查。
fail() { echo "[FAIL] $1" >&2; exit 1; }

# 确认检查流程依赖的本机命令均可用。
require_commands() {
  local name
  for name in "$@"; do
    command -v "$name" >/dev/null || fail "缺少命令：$name"
  done
}

# 检查指定 ComfyUI 接口是否可访问。
check_endpoint() {
  local path="$1"
  curl -fsS --connect-timeout 3 --max-time 10 "$COMFYUI_URL/$path" >/dev/null \
    || fail "RunPod ComfyUI /$path 不可访问"
}

# 返回服务器已安装的 MiniMax H3 标准工作流数量。
count_h3_workflows() {
  curl -fsS --connect-timeout 3 --max-time 15 \
    "$COMFYUI_URL/userdata?dir=workflows&recurse=true&split=false&full_info=true" \
    | node -e 'let body="";process.stdin.on("data",x=>body+=x).on("end",()=>{const names=new Set(JSON.parse(body).map(x=>x.path));const expected=["T2VA","I2VA","FL2VA","FL2VA-Loop","R2VA"].map(x=>`minimax/MiniMaxH3-Turbo-${x}-Qwen3.5.json`);console.log(expected.filter(x=>names.has(x)).length)})'
}

# 检查工作流依赖的 ComfyUI 节点是否存在。
check_workflow_node() {
  local node="$1"
  curl -fsS --connect-timeout 3 --max-time 15 "$COMFYUI_URL/object_info/$node" \
    | NODE_NAME="$node" node -e 'let body="";process.stdin.on("data",x=>body+=x).on("end",()=>process.exit(Object.hasOwn(JSON.parse(body),process.env.NODE_NAME)?0:1))' \
    || fail "RunPod 缺少工作流节点：$node"
}

# 1. 读取运行配置并校验调用方式。
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_settings="$(bash "$REPO_ROOT/app/common/config_loader.sh" shell "$REPO_ROOT/harness/config/settings.yaml")"
eval "$runtime_settings"
[[ "$#" -eq 0 ]] || fail '本脚本不接受参数'
require_commands curl node

# 2. 检查服务基础接口。
for path in system_stats queue; do
  check_endpoint "$path"
done

# 3. 检查五套工作流及其必需节点。
count="$(count_h3_workflows)"
[[ "$count" == 5 ]] || fail "RunPod 未提供完整五份 H3 工作流：$count/5"
for node in MiniMaxH3ImageToVideo MiniMaxH3ReferenceToVideo VHS_VideoCombine; do
  check_workflow_node "$node"
done

echo "[OK] RunPod ComfyUI 与五份 H3 工作流可用：$COMFYUI_URL"
