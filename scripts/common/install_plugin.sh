#!/usr/bin/env bash
set -Eeuo pipefail
fail() { echo "[FAIL] $1" >&2; exit 1; }
[[ "$#" -ge 1 && "$#" -le 2 && ( "$1" == tools || "$1" == ui ) && ( "$#" -eq 1 || "$2" == --prepare ) ]] || fail 'Usage: install_plugin.sh tools|ui [--prepare]'
kind="$1"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
export PATH="/root/miniconda3/bin:$PATH"
runtime_settings="$(python3 scripts/common/config_loader.py shell config/harness-settings.yaml)"
eval "$runtime_settings"
export PATH="$HARNESS_ROOT/runtime/node-v24.20.0-linux-x64/bin:$PATH"
export DSH_HOME="$HARNESS_ROOT/home"
dsh="$HARNESS_ROOT/app/node_modules/.bin/dsh"
plugin_dir="$HARNESS_ROOT/packages/dsh-elysium-$kind-registry"
[[ -x "$dsh" ]] || fail 'Harness 尚未安装'
[[ ! -e "$plugin_dir/node_modules" || -L "$plugin_dir/node_modules" ]] || fail '插件 node_modules 是真实目录，请先核对依赖布局'
if [[ "${2:-}" == --prepare ]]; then
  install -d -m 0755 "$plugin_dir"
  exit 0
fi
# 复用已安装 Harness 的依赖（UI 的 schemastery），不上传本机 node_modules。
ln -sfn "$HARNESS_ROOT/app/node_modules" "$plugin_dir/node_modules"
node --check "$plugin_dir/lib/index.js"
while IFS= read -r -d '' file; do node --check "$file"; done < <(find "$plugin_dir/lib" -type f -name '*.js' -print0)
[[ "$kind" != ui || -s "$plugin_dir/lib/client.js" ]] || fail 'UI 浏览器产物缺失'
node --input-type=module - "$plugin_dir/lib/index.js" <<'JS'
import { pathToFileURL } from 'node:url'
await import(pathToFileURL(process.argv[2]).href)
JS
python3 scripts/common/config_loader.py check config/harness-settings.yaml --harness-root "$HARNESS_ROOT"
"$dsh" plugin --profile web add --workspace-root "$plugin_dir"
node --input-type=module - "$DSH_HOME/profiles/web/package.json" "@dsh-external/dsh-elysium-$kind" <<'JS'
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8')), name = process.argv[3]
if (!profile.dependencies?.[name] || !profile.dsh?.profile?.bundles?.includes(name)) throw new Error('插件未正确注册到 web profile')
JS
bash scripts/common/start_harness.sh --restart
curl -fsS --max-time 5 "http://127.0.0.1:$HARNESS_WEB_PORT/" >/dev/null
echo "[DONE] dsh-elysium-$kind 已注册，Harness HTTP 健康检查通过"
