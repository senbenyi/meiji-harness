#!/usr/bin/env bash
set -Eeuo pipefail

# 职责：建立或复用本机到远端 Qwen API 的 SSH 端口转发，供本机 Harness 使用。
# 输入：无需参数；SSH 目标、模型 ID、主机和端口均来自统一配置。
# 流程：读取配置 → 检查依赖 → 识别旧通道 → 远端预检 → 建立通道 → 验收模型 API。

# 1. 定位并读取统一配置。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly CONFIG="$REPO_ROOT/harness/config/settings.yaml"
[[ -s "$CONFIG" ]] || { echo "[FAIL] 缺少配置：$CONFIG" >&2; exit 1; }
runtime_settings="$(bash "$REPO_ROOT/app/common/config_loader.sh" shell "$CONFIG")"
eval "$runtime_settings"

# 输出统一错误并终止隧道管理流程。
fail() { echo "[FAIL] $1" >&2; exit 1; }

# 2. 确认隧道检查和创建依赖的本机命令均可用。
for name in curl lsof ps ssh; do
  command -v "$name" >/dev/null 2>&1 || fail "缺少命令：$name"
done
ssh_options=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

# 从 OpenAI 兼容的模型列表中确认目标模型存在。
model_present() {
  node -e 'let body="";process.stdin.on("data",x=>body+=x).on("end",()=>process.exit(JSON.parse(body).data?.some(x=>x.id===process.argv[1])?0:1))' "$QWEN_MODEL_ID"
}

# 检查本地转发端口能否访问配置中的 Qwen 模型。
qwen_ready() {
  curl -fsS --max-time 5 "http://$QWEN_LOCAL_HOST:$QWEN_API_LOCAL_PORT/v1/models" 2>/dev/null | \
    model_present
}

# 返回占用本地转发端口的监听进程 PID；无监听器时返回空结果。
tunnel_listeners() {
  lsof -nP -tiTCP:"$QWEN_API_LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true
}

# 3. 识别现有监听器，只允许复用或替换符合当前配置的 SSH 通道。
listener_pids="$(tunnel_listeners)"
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

# 4. 在停止旧通道前，先验证 SSH 连接和远端模型 API。
ssh "${ssh_options[@]}" "$QWEN_SSH_TARGET" \
  "curl -fsS --max-time 5 'http://$QWEN_REMOTE_HOST:$QWEN_API_REMOTE_PORT/v1/models'" | \
  model_present || fail 'Qwen SSH 或模型 API 预检失败，未停止旧通道'

# 5. 停止旧通道并确认本地端口已释放。
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  echo "[TUNNEL] 停止旧通道：PID $pid"
  kill "$pid"
done <<<"$listener_pids"
for _ in {1..20}; do
  [[ -z "$(tunnel_listeners)" ]] && break
  sleep 0.1
done
[[ -z "$(tunnel_listeners)" ]] || \
  fail "旧通道未能释放端口 $QWEN_API_LOCAL_PORT"

# 6. 建立新通道，并以目标模型可访问作为最终验收条件。
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
