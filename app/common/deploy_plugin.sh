#!/usr/bin/env bash
set -Eeuo pipefail

# 职责：测试、构建并注册 Elysium 工具插件，同时安装本项目的 Harness 配置与 presets。
# 输入：唯一参数 tools；本机 DSH_HOME 来自统一配置。
# 流程：检查环境 → 构建插件 → 注册插件 → 安装配置 → 同步 presets。

# 输出统一错误并终止部署。
fail() { echo "[FAIL] $1" >&2; exit 1; }

# 确认部署流程依赖的本机命令均可用。
require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null || fail "本机缺少命令：$command_name"
  done
}

# 在独立工作目录中完成依赖安装、测试、构建和 registry 打包。
build_plugin() {
  (
    cd "$PACKAGE_ROOT"
    pnpm install --frozen-lockfile --ignore-scripts
    pnpm test
    pnpm build
    pnpm package:registry
  )
}

# 验证插件同时写入 web profile 的依赖和 bundle 清单。
verify_plugin_registration() {
  node --input-type=module - "$DSH_HOME/profiles/web/package.json" "@dsh-external/dsh-elysium-$kind" <<'JS'
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8')), name = process.argv[3]
if (!profile.dependencies?.[name] || !profile.dsh?.profile?.bundles?.includes(name)) throw new Error('插件未正确注册到本机 web profile')
JS
}

# 以仓库中的 preset 为准，替换 DSH_HOME 下对应的项目 preset。
sync_agent_presets() {
  local preset target
  mkdir -p "$DSH_HOME/.agent-presets"
  for preset in _base elysium-standard elysium-teaching elysium-free elysium-director; do
    target="$DSH_HOME/.agent-presets/$preset"
    [[ ! -e "$target" && ! -L "$target" ]] || rm -r -- "$target"
    cp -R "$REPO_ROOT/harness/.agent-presets/$preset" "$target"
  done
}

# 1. 校验参数、命令和本机目录。
[[ "$#" -eq 1 && "$1" == tools ]] || fail 'Usage: deploy_plugin.sh tools'
kind="$1"
require_commands node pnpm dsh
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_ROOT="$REPO_ROOT/dsh-elysium-$kind"
runtime_settings="$(bash "$REPO_ROOT/app/common/config_loader.sh" shell "$REPO_ROOT/harness/config/settings.yaml")"
eval "$runtime_settings"
export DSH_HOME="$LOCAL_DSH_HOME"
[[ -s "$PACKAGE_ROOT/package.json" ]] || fail '插件目录不存在'
[[ "$DSH_HOME" == /* ]] || fail "本机 DSH_HOME 必须为绝对路径：$DSH_HOME"
mkdir -p "$DSH_HOME"
[[ -w "$DSH_HOME" ]] || fail "本机 DSH_HOME 不可写：$DSH_HOME"

echo '[1/5] 检查本机 Harness 环境'
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || fail '需要 Node.js 20+'

# 2. 先通过测试，再生成可注册的 registry 包。
echo "[2/5] 测试、构建并打包 dsh-elysium-$kind"
build_plugin

# 3. 注册并检查 web profile，避免只写入部分插件状态。
echo '[3/5] 初始化 web profile 并注册插件'
dsh plugin --profile web add --workspace-root "$PACKAGE_ROOT/registry"
verify_plugin_registration

# 4. 先写临时文件，再原子替换 Harness 设置和 web profile 配置。
echo '[4/5] 安装 Harness 设置与 web profile 配置'
settings_tmp="$(mktemp "$DSH_HOME/.settings.XXXXXX")"
profile_tmp="$(mktemp "$DSH_HOME/profiles/web/.cordis.patch.XXXXXX")"
trap 'rm -f -- "$settings_tmp" "$profile_tmp"' EXIT
bash "$REPO_ROOT/app/common/config_loader.sh" render "$REPO_ROOT/harness/config/settings.yaml" >"$settings_tmp"
bash "$REPO_ROOT/app/common/config_loader.sh" profile "$REPO_ROOT/harness/config/settings.yaml" >"$profile_tmp"
chmod 0600 "$settings_tmp" "$profile_tmp"
mv -f "$settings_tmp" "$DSH_HOME/settings.yaml"
mv -f "$profile_tmp" "$DSH_HOME/profiles/web/cordis.patch.yml"
trap - EXIT

# 5. 同步 presets；已有目录或符号链接均以当前项目版本替换。
echo '[5/5] 同步当前项目的 Agent presets'
sync_agent_presets

echo '[DONE] 当前项目配置已安装；请手动运行 dsh web'
