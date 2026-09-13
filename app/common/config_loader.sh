#!/usr/bin/env bash
set -Eeuo pipefail

# 职责：读取统一 YAML 配置，并输出脚本变量、Harness 配置或 web profile 配置。
# 输入：模式 shell、render 或 profile；可选第二个参数指定配置文件。
# 流程：校验参数 → 读取运行字段 → 校验字段 → 按模式生成目标配置。

# 输出带统一前缀的配置错误并终止脚本。
fail() { echo "[FAIL] 配置读取失败：$1" >&2; exit 1; }

# 从指定 YAML 一级分区读取一个二级标量字段。
read_scalar() {
  local section="$1" key="$2"
  awk -v section="$section" -v key="$key" '
    /^[^[:space:]#][^:]*:[[:space:]]*$/ { active = ($0 == section ":"); next }
    active && index($0, "  " key ":") == 1 {
      value = substr($0, length(key) + 4)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      print value
      found = 1
      exit
    }
    END { if (!found) exit 1 }
  ' "$config"
}

# 以可安全 eval 的 shell 赋值格式输出运行参数。
emit_shell_settings() {
  local key permission_mode
  for key in "${runtime_keys[@]}"; do
    printf '%s=%q\n' "$key" "${!key}"
  done
  permission_mode="$(read_scalar permission defaultPreset)" || fail 'permission.defaultPreset 缺失'
  printf 'DSH_PERMISSION_MODE=%q\n' "$permission_mode"
}

# 提取 harness-customization.profile，并替换运行时占位符。
emit_profile() {
  awk -v comfy_url="$COMFYUI_URL" '
    $0 == "harness-customization:" { customization = 1; next }
    customization && /^[^[:space:]#]/ { exit }
    customization && $0 ~ /^  profile:[[:space:]]*$/ { profile = 1; next }
    profile && /^    / {
      line = substr($0, 5)
      gsub(/__COMFYUI_URL__/, comfy_url, line)
      print line
      found = 1
    }
    END { if (!found) exit 1 }
  ' "$config" || fail 'harness-customization.profile 缺失'
}

# 移除仅供本机脚本使用的分区，并渲染 Harness 配置模板。
render_settings() {
  awk -v qwen_port="$QWEN_API_LOCAL_PORT" -v qwen_model="$QWEN_MODEL_ID" \
    -v qwen_host="$QWEN_LOCAL_HOST" -v comfy_url="$COMFYUI_URL" '
    /^[^[:space:]#][^:]*:[[:space:]]*$/ {
      skip = ($0 == "harness-runtime:" || $0 == "harness-customization:")
    }
    skip { next }
    {
      gsub(/__QWEN_API_LOCAL_PORT__/, qwen_port)
      gsub(/__QWEN_MODEL_ID__/, qwen_model)
      gsub(/__QWEN_LOCAL_HOST__/, qwen_host)
      gsub(/__COMFYUI_URL__/, comfy_url)
      print
    }
  ' "$config"
}

# 1. 解析调用参数并定位配置文件。
[[ "$#" -ge 1 && "$#" -le 2 ]] || fail 'Usage: config_loader.sh <shell|render|profile> [config]'
mode="$1"
[[ "$mode" == shell || "$mode" == render || "$mode" == profile ]] || fail "不支持的模式：$mode"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
config="${2:-$script_dir/../../harness/config/settings.yaml}"
[[ -s "$config" ]] || fail "配置不存在：$config"

# 2. 读取所有脚本共享的运行参数。
runtime_keys=(
  QWEN_SSH_TARGET QWEN_MODEL_ID
  QWEN_API_LOCAL_PORT QWEN_API_REMOTE_PORT
  LOCAL_HARNESS_PORT QWEN_LOCAL_HOST QWEN_REMOTE_HOST LOCAL_HARNESS_HOST
  LOCAL_DSH_HOME COMFYUI_URL
)
for key in "${runtime_keys[@]}"; do
  value="$(read_scalar harness-runtime "$key")" || fail "$key 缺失"
  [[ -n "$value" ]] || fail "$key 缺失或为空"
  printf -v "$key" '%s' "$value"
done

# 3. 在输出任何配置前校验运行参数。
[[ "$QWEN_SSH_TARGET" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9._-]+)?$ ]] || fail 'QWEN_SSH_TARGET 格式无效'
[[ "$QWEN_MODEL_ID" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'QWEN_MODEL_ID 格式无效'
for key in QWEN_API_LOCAL_PORT QWEN_API_REMOTE_PORT LOCAL_HARNESS_PORT; do
  value="${!key}"
  [[ "$value" =~ ^[0-9]+$ ]] && ((10#$value >= 1 && 10#$value <= 65535)) || fail "$key 必须在 1–65535 之间"
done
for key in QWEN_LOCAL_HOST QWEN_REMOTE_HOST LOCAL_HARNESS_HOST; do
  [[ "${!key}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "$key 格式无效"
done
[[ "$LOCAL_DSH_HOME" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail 'LOCAL_DSH_HOME 格式无效'
[[ "$COMFYUI_URL" =~ ^https?://[A-Za-z0-9][A-Za-z0-9._-]*(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$ ]] || fail 'COMFYUI_URL 必须为不含凭据、查询参数的 HTTP(S) 地址'
if [[ "$COMFYUI_URL" =~ :([0-9]+)(/|$) ]]; then
  port="${BASH_REMATCH[1]}"
  ((10#$port >= 1 && 10#$port <= 65535)) || fail 'COMFYUI_URL 端口无效'
fi

# 4. 按调用模式生成唯一一种输出。
case "$mode" in
  shell) emit_shell_settings ;;
  profile) emit_profile ;;
  render) render_settings ;;
esac
