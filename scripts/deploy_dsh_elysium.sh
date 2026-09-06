#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "[FAIL] $1" >&2; exit 1; }

[[ "$#" -eq 0 ]] || fail '本脚本不接受参数，固定部署到 veo-comfyui'
for command_name in git python3 node pnpm rsync ssh; do
  command -v "$command_name" >/dev/null || fail "本机缺少命令：$command_name"
done
REPO_ROOT="$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
CORE_ROOT="$REPO_ROOT/dsh-elysium"
runtime_settings="$(python3 "$REPO_ROOT/scripts/common/config_loader.py" shell "$REPO_ROOT/config/harness-settings.yaml")"
eval "$runtime_settings"

TARGET=veo-comfyui
CORE_DEST="$HARNESS_ROOT/packages/dsh-elysium-registry"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)
HARNESS_FILES=(
  config/harness-settings.yaml config/harness-agent.md config/system-prompt.yaml config/ssh_config
  scripts/common/config_loader.py scripts/common/start_harness.sh scripts/common/start_tunnel_qwen.sh
)
[[ -s "$CORE_ROOT/package.json" ]] || fail '核心插件目录不存在'
for file in "${HARNESS_FILES[@]}"; do
  [[ -s "$REPO_ROOT/$file" ]] || fail "文件不存在或为空：$file"
done

echo '[1/4] 检查远端环境'
"${SSH[@]}" "$TARGET" bash -s -- "$HARNESS_ROOT" "$CORE_DEST" <<'REMOTE'
set -Eeuo pipefail
harness_root="$1"
core_dest="$2"
[[ -x "$harness_root/app/node_modules/.bin/dsh" && \
   -x "$harness_root/runtime/node-v24.20.0-linux-x64/bin/node" ]] || {
  echo '[FAIL] Harness 尚未安装' >&2; exit 1;
}
# 核心插件复用 Harness 依赖；不删除已有真实目录。
if [[ -e "$core_dest/node_modules" && ! -L "$core_dest/node_modules" ]]; then
  echo '[FAIL] 核心插件 node_modules 是真实目录，请先核对依赖布局' >&2
  exit 1
fi
REMOTE

echo '[2/4] 构建并打包 dsh-elysium（不运行测试）'
(
  cd "$CORE_ROOT"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm build
  node scripts/package-registry.mjs
)

echo '[3/4] 上传核心插件和启动配置'
"${SSH[@]}" "$TARGET" "install -d -m 0755 '$CORE_DEST' '$PLUGINS_ROOT'"
# 保留服务器依赖链接，仅同步核心插件产物。
rsync -az --delete --exclude='node_modules' -e "${SSH[*]}" \
  "$CORE_ROOT/registry/" "$TARGET:$CORE_DEST/"
(
  cd "$REPO_ROOT"
  rsync -azR -e "${SSH[*]}" "${HARNESS_FILES[@]}" "$TARGET:$PLUGINS_ROOT/"
)

echo '[4/4] 注册核心插件、应用配置并重启 Harness'
"${SSH[@]}" "$TARGET" bash -s -- "$HARNESS_ROOT" "$CORE_DEST" "$PLUGINS_ROOT" "$HARNESS_WEB_PORT" <<'REMOTE'
set -Eeuo pipefail
harness_root="$1"
core_dest="$2"
plugins_root="$3"
port="$4"
export PATH="$harness_root/runtime/node-v24.20.0-linux-x64/bin:/root/miniconda3/bin:$PATH"
export DSH_HOME="$harness_root/home"
if [[ -e "$core_dest/node_modules" && ! -L "$core_dest/node_modules" ]]; then
  echo '[FAIL] 核心插件 node_modules 是真实目录' >&2; exit 1
fi
ln -sfn "$harness_root/app/node_modules" "$core_dest/node_modules"
for file in "$core_dest"/lib/*.js; do
  node --check "$file"
done
python3 "$plugins_root/scripts/common/config_loader.py" check \
  "$plugins_root/config/harness-settings.yaml" --harness-root "$harness_root"
"$harness_root/app/node_modules/.bin/dsh" plugin --profile web add --workspace-root "$core_dest"
bash "$plugins_root/scripts/common/start_harness.sh" --restart
curl -fsS --max-time 5 "http://127.0.0.1:$port/" >/dev/null
curl -fsS --max-time 10 -X POST -H 'content-type: application/json' -d '{}' \
  "http://127.0.0.1:$port/elysium/api/project.list" >/dev/null
REMOTE

echo '[DONE] 核心插件已发布，Harness 已重启并通过 HTTP 检查；请刷新页面确认侧栏宽度'
