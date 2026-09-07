#!/usr/bin/env bash
set -Eeuo pipefail
# 服务器端 tools 插件安装入口。
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/common/install_plugin.sh" tools "$@"
