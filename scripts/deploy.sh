#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
readonly REPO_ROOT
MODEL_ROOT="$(cd -- "$REPO_ROOT/../llm-ai-model" && pwd)"
readonly MODEL_ROOT
readonly CORE_ROOT="$REPO_ROOT/dsh-elysium"
readonly TOOLS_ROOT="$REPO_ROOT/dsh-elysium-tools"
readonly TARGET=veo-comfyui
readonly PROJECT_DEST=/root/autodl-tmp/project
readonly HARNESS_ROOT=/root/autodl-tmp/wan22-harness
readonly CORE_DEST="$HARNESS_ROOT/packages/dsh-elysium-registry"
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
[[ -s "$CORE_ROOT/package.json" ]] || fail "核心插件目录无效：$CORE_ROOT"
[[ -s "$TOOLS_ROOT/package.json" ]] || fail "工具插件目录无效：$TOOLS_ROOT"
[[ -x "$MODEL_ROOT/scripts/workflow/adult_short_video.sh" ]] || \
  fail "工作流入口不存在或不可执行：$MODEL_ROOT/scripts/workflow/adult_short_video.sh"

echo '[1/4] 本地构建并打包'
(
  cd "$CORE_ROOT"
  pnpm install --frozen-lockfile
  pnpm build
  node scripts/package-registry.mjs
)
(
  cd "$TOOLS_ROOT"
  pnpm install --frozen-lockfile
  pnpm build
  pnpm package:registry
)

echo '[2/4] 发布工作流入口与插件包到服务器'
ssh "${SSH_OPTIONS[@]}" "$TARGET" bash -s -- "$PROJECT_DEST" "$HARNESS_ROOT" "$CORE_DEST" "$TOOLS_DEST" <<'REMOTE'
set -Eeuo pipefail
project_dest="$1"
harness_root="$2"
core_dest="$3"
tools_dest="$4"

[[ -x "$project_dest/scripts/boot/start_harness.sh" ]] || {
  echo '[FAIL] Harness 启动脚本不存在，请先部署 llm-ai-model' >&2
  exit 1
}
for endpoint in \
  generate_dialogue.sh generate_image.sh generate_video_audio.sh generate_video_long.sh \
  interpolate_video.sh upscale_video.sh; do
  [[ -x "$project_dest/scripts/endpoint/$endpoint" ]] || {
    echo "[FAIL] 模型入口不存在：$project_dest/scripts/endpoint/$endpoint" >&2
    exit 1
  }
done
[[ -x "$harness_root/app/node_modules/.bin/dsh" ]] || {
  echo '[FAIL] DeepSeek Harness 尚未安装' >&2
  exit 1
}
install -d -m 0755 "$core_dest" "$tools_dest" "$project_dest/scripts/workflow"
REMOTE
rsync -az --delete -e "$SSH_TRANSPORT" \
  "$MODEL_ROOT/scripts/workflow/" "$TARGET:$PROJECT_DEST/scripts/workflow/"
rsync -az --delete -e "$SSH_TRANSPORT" \
  "$CORE_ROOT/registry/" "$TARGET:$CORE_DEST/"
rsync -az --delete -e "$SSH_TRANSPORT" \
  "$TOOLS_ROOT/registry/" "$TARGET:$TOOLS_DEST/"

echo '[3/4] 服务器注册插件并重启 Harness'
ssh "${SSH_OPTIONS[@]}" "$TARGET" bash -s -- "$PROJECT_DEST" "$HARNESS_ROOT" "$CORE_DEST" "$TOOLS_DEST" <<'REMOTE'
set -Eeuo pipefail
project_dest="$1"
harness_root="$2"
core_dest="$3"
tools_dest="$4"
node_root="$harness_root/runtime/node-v24.20.0-linux-x64"
dsh_bin="$harness_root/app/node_modules/.bin/dsh"

[[ -x "$project_dest/scripts/workflow/adult_short_video.sh" ]] || {
  echo '[FAIL] workflow_adult_short_video 发布失败' >&2
  exit 1
}
"$node_root/bin/node" --check "$core_dest/lib/index.js"
"$node_root/bin/node" --check "$tools_dest/lib/index.js"
for source_file in "$tools_dest"/lib/models/*.js "$tools_dest"/lib/workflows/*.js; do
  "$node_root/bin/node" --check "$source_file"
done

env \
  PATH="$node_root/bin:$PATH" \
  DSH_HOME="$harness_root/home" \
  "$dsh_bin" plugin --profile web add --workspace-root "$core_dest"
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
curl -fsS -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:3080/elysium/api/director.list >/dev/null
REMOTE

echo '[DONE] dsh-elysium 与 dsh-elysium-tools 已完成构建、发布、注册和 Harness 重启'
