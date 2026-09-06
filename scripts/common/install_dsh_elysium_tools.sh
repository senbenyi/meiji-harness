#!/usr/bin/env bash
set -Eeuo pipefail

# 在服务器部署目录执行；--prepare 仅检查环境并创建产物目录。
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
[[ "$#" -eq 0 || ( "$#" -eq 1 && "$1" == --prepare ) ]] || {
  echo 'Usage: install_dsh_elysium_tools.sh [--prepare]' >&2; exit 1;
}
export PATH="/root/miniconda3/bin:$PATH"
runtime_settings="$(python3 scripts/common/config_loader.py shell config/harness-settings.yaml)"
eval "$runtime_settings"
export PATH="$HARNESS_ROOT/runtime/node-v24.20.0-linux-x64/bin:$PATH"
export DSH_HOME="$HARNESS_ROOT/home"
dsh="$HARNESS_ROOT/app/node_modules/.bin/dsh"
tools_dir="$HARNESS_ROOT/packages/dsh-elysium-tools-registry"

[[ -x "$dsh" ]] || { echo '[FAIL] Harness 尚未安装' >&2; exit 1; }
if [[ "${1:-}" == --prepare ]]; then
  install -d -m 0755 "$tools_dir"
  exit 0
fi

# 注册前检查产物和配置；失败时保留运行中的服务。
for file in "$tools_dir/lib/index.js" "$tools_dir"/lib/{models,workflows}/*.js; do
  node --check "$file"
done
python3 scripts/common/config_loader.py check config/harness-settings.yaml --harness-root "$HARNESS_ROOT"
"$dsh" plugin --profile web add --workspace-root "$tools_dir"
bash scripts/common/start_harness.sh --restart
curl -fsS --max-time 5 "http://127.0.0.1:$HARNESS_WEB_PORT/" >/dev/null
echo '[DONE] 插件已安装，Harness 已重启并通过健康检查'
