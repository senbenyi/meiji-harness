#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
TOOLS_ROOT="$REPO_ROOT/dsh-elysium-tools"
HARNESS_FILES=(config/harness-settings.yaml config/harness-agent.md config/system-prompt.yaml config/ssh_config scripts/common/config_loader.py scripts/install_dsh_elysium_tools.sh scripts/start_harness.sh scripts/start_tunnel_qwen.sh)
runtime_settings="$(python3 "$REPO_ROOT/scripts/common/config_loader.py" shell "$REPO_ROOT/config/harness-settings.yaml")"
eval "$runtime_settings"

TARGET=veo-comfyui
PLUGIN_DEST="$PLUGINS_ROOT"
TOOLS_DEST="$HARNESS_ROOT/packages/dsh-elysium-tools-registry"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)

fail() { echo "[FAIL] $1" >&2; exit 1; }

# 检查本地依赖与待上传文件。
[[ "$#" -eq 0 ]] || fail '本脚本不接受参数，固定部署到 veo-comfyui'
for command_name in pnpm rsync ssh; do
  command -v "$command_name" >/dev/null || fail "本机缺少命令：$command_name"
done
[[ -s "$TOOLS_ROOT/package.json" ]] || fail '工具插件目录不存在'

for file in "${HARNESS_FILES[@]}"; do
  [[ -s "$REPO_ROOT/$file" ]] || fail "文件不存在或为空：$file"
done

echo '[1/4] 上传 .dsh、config、scripts'
"${SSH[@]}" "$TARGET" "install -d -m 0755 '$PLUGIN_DEST'"
rsync -az --delete --exclude='__pycache__/' -e "${SSH[*]}" \
  "$REPO_ROOT/.dsh" "$REPO_ROOT/config" "$REPO_ROOT/scripts" "$TARGET:$PLUGIN_DEST/"

"${SSH[@]}" "$TARGET" "cd '$PLUGIN_DEST' && bash scripts/install_dsh_elysium_tools.sh --prepare"

# 2. 本地构建工具插件。
echo '[2/4] 构建并打包'
(
  cd "$TOOLS_ROOT"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm build
  pnpm package:registry
)

# 3. 上传构建产物。
echo '[3/4] 上传插件'
rsync -az --delete -e "${SSH[*]}" "$TOOLS_ROOT/registry/" "$TARGET:$TOOLS_DEST/"

# 4. 服务器注册插件、应用配置、重启并检查服务。
echo '[4/4] 应用配置并重启'
"${SSH[@]}" "$TARGET" "cd '$PLUGIN_DEST' && bash scripts/install_dsh_elysium_tools.sh"

echo '[DONE] 插件和提示词已更新，Harness 已重启并通过健康检查'
