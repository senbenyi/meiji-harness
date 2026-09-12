#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "[FAIL] $1" >&2; exit 1; }
[[ "$#" -eq 1 && ( "$1" == tools || "$1" == ui ) ]] || fail 'Usage: deploy_plugin.sh tools|ui'
kind="$1"
for command_name in node pnpm dsh lsof ps curl python3; do
  command -v "$command_name" >/dev/null || fail "本机缺少命令：$command_name"
done
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_ROOT="$REPO_ROOT/dsh-elysium-$kind"
runtime_settings="$(python3 "$REPO_ROOT/app/common/config_loader.py" shell "$REPO_ROOT/harness/config/harness-settings.yaml")"
eval "$runtime_settings"
export DSH_HOME="$LOCAL_DSH_HOME"
[[ -s "$PACKAGE_ROOT/package.json" ]] || fail '插件目录不存在'
[[ "$DSH_HOME" == /* && -w "$DSH_HOME" ]] || fail "本机 DSH_HOME 不可写：$DSH_HOME"

echo '[1/4] 检查本机 Harness 环境'
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || fail '需要 Node.js 20+'

echo "[2/4] 测试、构建并打包 dsh-elysium-$kind"
(
  cd "$PACKAGE_ROOT"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm test
  pnpm build
  pnpm package:registry
)

echo '[3/4] 注册到本机 Harness web profile'
dsh plugin --profile web add --workspace-root "$PACKAGE_ROOT/registry"
node --input-type=module - "$DSH_HOME/profiles/web/package.json" "@dsh-external/dsh-elysium-$kind" <<'JS'
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8')), name = process.argv[3]
if (!profile.dependencies?.[name] || !profile.dsh?.profile?.bundles?.includes(name)) throw new Error('插件未正确注册到本机 web profile')
JS
if [[ "$kind" == tools ]]; then
  mkdir -p "$DSH_HOME/.agent-presets"
  for preset in elysium-standard elysium-teaching elysium-free elysium-director; do
    if [[ ! -e "$DSH_HOME/.agent-presets/$preset" ]]; then
      cp -R "$REPO_ROOT/harness/.agent-presets/$preset" "$DSH_HOME/.agent-presets/"
    fi
  done
fi

echo '[4/4] 重启本机 Harness 并检查 HTTP'
bash "$REPO_ROOT/app/common/start_harness.sh" --restart
echo "[DONE] dsh-elysium-$kind 已发布：http://$LOCAL_HARNESS_HOST:$LOCAL_HARNESS_PORT/"
