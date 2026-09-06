#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
readonly REPO_ROOT
readonly TOOLS_ROOT="$REPO_ROOT/dsh-elysium-tools"
readonly TARGET=veo-comfyui
readonly PROJECT_DEST=/root/autodl-tmp/project
readonly HARNESS_ROOT=/root/autodl-tmp/wan22-harness
readonly TOOLS_DEST="$HARNESS_ROOT/packages/dsh-elysium-tools-registry"
readonly SSH_TRANSPORT='ssh -o BatchMode=yes -o ConnectTimeout=10'
readonly -a SSH_OPTIONS=(-o BatchMode=yes -o ConnectTimeout=10)

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

[[ "$#" -eq 0 ]] || fail '本脚本不接受参数，固定部署到 veo-comfyui'
for command_name in git pnpm rsync ssh; do
  command -v "$command_name" >/dev/null || fail "本机缺少命令：$command_name"
done
[[ -s "$TOOLS_ROOT/package.json" ]] || fail "工具插件目录无效：$TOOLS_ROOT"

echo '[1/4] 本地构建并打包'
(
  cd "$TOOLS_ROOT"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm build
  pnpm package:registry
)

echo '[2/4] 发布 dsh-elysium-tools 插件包到服务器'
ssh "${SSH_OPTIONS[@]}" "$TARGET" bash -s -- "$PROJECT_DEST" "$HARNESS_ROOT" "$TOOLS_DEST" <<'REMOTE'
set -Eeuo pipefail
project_dest="$1"
harness_root="$2"
tools_dest="$3"

[[ -x "$project_dest/scripts/boot/start_harness.sh" ]] || {
  echo '[FAIL] Harness 启动脚本不存在，请先部署 llm-ai-model' >&2
  exit 1
}
[[ -x "$harness_root/app/node_modules/.bin/dsh" ]] || {
  echo '[FAIL] DeepSeek Harness 尚未安装' >&2
  exit 1
}
install -d -m 0755 "$tools_dest"
REMOTE
rsync -az --delete -e "$SSH_TRANSPORT" \
  "$TOOLS_ROOT/registry/" "$TARGET:$TOOLS_DEST/"

echo '[3/4] 服务器注册插件并重启 Harness'
ssh "${SSH_OPTIONS[@]}" "$TARGET" bash -s -- "$PROJECT_DEST" "$HARNESS_ROOT" "$TOOLS_DEST" <<'REMOTE'
set -Eeuo pipefail
project_dest="$1"
harness_root="$2"
tools_dest="$3"
node_root="$harness_root/runtime/node-v24.20.0-linux-x64"
dsh_bin="$harness_root/app/node_modules/.bin/dsh"

"$node_root/bin/node" --check "$tools_dest/lib/index.js"
for source_file in "$tools_dest"/lib/models/*.js "$tools_dest"/lib/workflows/*.js; do
  "$node_root/bin/node" --check "$source_file"
done

env \
  PATH="$node_root/bin:$PATH" \
  DSH_HOME="$harness_root/home" \
  "$dsh_bin" plugin --profile web add --workspace-root "$tools_dest"
bash "$project_dest/scripts/boot/start_harness.sh" --restart
REMOTE

echo '[4/4] 验证服务'
ssh "${SSH_OPTIONS[@]}" "$TARGET" bash -s <<'REMOTE'
set -Eeuo pipefail
curl -fsS http://127.0.0.1:3080/ >/dev/null
REMOTE

echo '[DONE] dsh-elysium-tools 已完成构建、发布、注册和 Harness 重启'
