#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "[FAIL] $1" >&2; exit 1; }
[[ "$#" -eq 1 && ( "$1" == tools || "$1" == ui ) ]] || fail 'Usage: deploy_plugin.sh tools|ui'
kind="$1"
for command_name in git pnpm rsync ssh; do
  command -v "$command_name" >/dev/null || fail "本机缺少命令：$command_name"
done
export PYTHON_BIN="${PYTHON_BIN:-python3}"
command -v "$PYTHON_BIN" >/dev/null || fail "本机缺少 Python：$PYTHON_BIN"
REPO_ROOT="$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
PACKAGE_ROOT="$REPO_ROOT/dsh-elysium-$kind"
runtime_settings="$("$PYTHON_BIN" "$REPO_ROOT/app/common/config_loader.py" shell "$REPO_ROOT/config/harness-settings.yaml")"
eval "$runtime_settings"
TARGET=veo-comfyui
DEST="$HARNESS_ROOT/packages/dsh-elysium-$kind-registry"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)
[[ -s "$PACKAGE_ROOT/package.json" && -d "$REPO_ROOT/.dsh" ]] || fail '插件或技能目录不存在'
for file in config/harness-settings.yaml config/harness-agent.md config/system-prompt.yaml config/ssh_config \
  app/common/config_loader.py app/common/install_plugin.sh app/common/start_harness.sh app/common/start_tunnel_qwen.sh app/common/start_tunnel_harness.sh; do
  [[ -s "$REPO_ROOT/$file" ]] || fail "缺少文件：$file"
done

echo '[1/4] 检查远端环境'
"${SSH[@]}" "$TARGET" "test -x '$HARNESS_ROOT/app/node_modules/.bin/dsh' && test -x '$HARNESS_ROOT/runtime/node-v24.20.0-linux-x64/bin/node'"

echo "[2/4] 测试、构建并打包 dsh-elysium-$kind"
(
  cd "$PACKAGE_ROOT"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm test
  pnpm build
  pnpm package:registry
)

echo '[3/4] 上传配置、技能及插件'
"${SSH[@]}" "$TARGET" "install -d -m 0755 '$PLUGINS_ROOT'"
rsync -az --delete -e "${SSH[*]}" "$REPO_ROOT/.dsh/" "$TARGET:$PLUGINS_ROOT/.dsh/"
rsync -az --delete --exclude='__pycache__/' -e "${SSH[*]}" "$REPO_ROOT/config" "$REPO_ROOT/app" "$TARGET:$PLUGINS_ROOT/"
"${SSH[@]}" "$TARGET" "cd '$PLUGINS_ROOT' && bash app/common/install_plugin.sh '$kind' --prepare"
# node_modules 由远端安装器管理，不参与本机产物镜像。
rsync -az --delete --exclude='node_modules' -e "${SSH[*]}" "$PACKAGE_ROOT/registry/" "$TARGET:$DEST/"

echo '[4/4] 注册插件、应用配置并重启'
"${SSH[@]}" "$TARGET" "cd '$PLUGINS_ROOT' && bash app/common/install_plugin.sh '$kind'"
# 隧道复用本机 Python 选择，远端安装器独立配置 Python。
bash "$REPO_ROOT/app/common/start_tunnel_harness.sh"
echo "[DONE] dsh-elysium-$kind 已发布：http://127.0.0.1:$HARNESS_LOCAL_PORT/"
echo 'HTTP 健康检查不替代浏览器任务卡和媒体播放验收，请刷新页面检查。'
