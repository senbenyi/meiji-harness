#!/usr/bin/env bash
set -Eeuo pipefail

readonly HARNESS_ROOT=/workspace/harness
readonly NODE_VERSION=24.20.0
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
readonly NODE_SHA256=2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2
readonly NODE_ROOT="$HARNESS_ROOT/runtime/node-v${NODE_VERSION}-linux-x64"
readonly DSH_VERSION=0.1.2-rc.1
readonly PNPM_VERSION=9.12.3
readonly HTTP_PROXY_VERSION=1.18.1
readonly APP_ROOT="$HARNESS_ROOT/app"
readonly HOME_ROOT="$HARNESS_ROOT/home"
readonly PACKAGE_ROOT="$HARNESS_ROOT/packages"
readonly CACHE_ROOT="$HARNESS_ROOT/cache"
readonly LOG_ROOT="$HARNESS_ROOT/logs"
readonly AUTOSTART_ROOT=/workspace/runpod-slim/ComfyUI/custom_nodes/harness-autostart
readonly COMFYUI_ROOT=/workspace/runpod-slim
readonly PROXY_PASSWORD_FILE="$HARNESS_ROOT/config/proxy-password"
readonly OPERATOR_ROOT="$HARNESS_ROOT/operator-workspace"
readonly SERVICE_USER=harness

fail() { echo "[FAIL] $1" >&2; exit 1; }

((EUID == 0)) || fail '请使用 root 执行'
[[ "$(uname -m)" == x86_64 ]] || fail '固定 Node.js 包仅支持 x86_64'
for command_name in chown curl id install openssl sha256sum tar useradd; do
  command -v "$command_name" >/dev/null || fail "缺少命令：$command_name"
done
for path in \
  "$PACKAGE_ROOT/dsh-elysium-tools/package.json" \
  "$PACKAGE_ROOT/dsh-elysium-ui/package.json" \
  "$HARNESS_ROOT/config/profile.patch.yml" \
  "$HARNESS_ROOT/config/operator-agent.cordis.yml" \
  "$HARNESS_ROOT/config/operator-security.patch.yml" \
  "$HARNESS_ROOT/config/settings.yaml" \
  "$HARNESS_ROOT/config/comfyui-autostart.py" \
  "$HARNESS_ROOT/config/proxy.mjs" \
  "$HARNESS_ROOT/qwen-tunnel.sh" \
  "$HARNESS_ROOT/start.sh"; do
  [[ -s "$path" ]] || fail "部署文件不存在：$path"
done
for preset in standard elysium-teaching elysium-free elysium-director; do
  [[ -d "$HARNESS_ROOT/.agent-presets/$preset" ]] || fail "预设目录不存在：$HARNESS_ROOT/.agent-presets/$preset"
done

id -u "$SERVICE_USER" >/dev/null 2>&1 || \
  useradd --system --no-create-home --home-dir "$HOME_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
readonly SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
install -d -m 0750 "$HARNESS_ROOT/runtime" "$APP_ROOT" "$CACHE_ROOT/npm" "$HARNESS_ROOT/downloads"
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 "$HOME_ROOT" "$LOG_ROOT" "$OPERATOR_ROOT"
chown root:"$SERVICE_GROUP" "$HARNESS_ROOT/runtime" "$APP_ROOT" "$PACKAGE_ROOT"
chmod 0750 "$HARNESS_ROOT/runtime" "$APP_ROOT" "$PACKAGE_ROOT"

if [[ ! -x "$NODE_ROOT/bin/node" ]]; then
  archive="$HARNESS_ROOT/downloads/$NODE_ARCHIVE"
  if [[ ! -f "$archive" ]] || ! echo "$NODE_SHA256  $archive" | sha256sum -c -; then
    curl -fL --retry 5 --retry-delay 2 -o "$archive.part" "$NODE_URL"
    echo "$NODE_SHA256  $archive.part" | sha256sum -c -
    mv "$archive.part" "$archive"
  fi
  staging="$(mktemp -d "$HARNESS_ROOT/runtime/.node.XXXXXX")"
  trap 'rm -rf -- "$staging"' EXIT
  tar -xJf "$archive" --strip-components=1 -C "$staging"
  mv "$staging" "$NODE_ROOT"
  trap - EXIT
fi
chown root:"$SERVICE_GROUP" "$NODE_ROOT"
chmod 0750 "$NODE_ROOT"

export PATH="$NODE_ROOT/bin:$PATH"
export DSH_HOME="$HOME_ROOT"
export CI=1
export npm_config_cache="$CACHE_ROOT/npm"
export npm_config_audit=false
export npm_config_fund=false
export npm_config_update_notifier=false

installed_version=''
if [[ -f "$APP_ROOT/node_modules/@deepseek-ai/dsh/package.json" ]]; then
  installed_version="$(node -p "require('$APP_ROOT/node_modules/@deepseek-ai/dsh/package.json').version")"
fi
if [[ "$installed_version" != "$DSH_VERSION" ]]; then
  npm install --prefix "$APP_ROOT" --save-exact "@deepseek-ai/dsh@$DSH_VERSION"
fi

for package in \
  @deepseek-ai/dsh-subprocess-local@0.1.2-rc.1 \
  @google/genai@1.52.0 \
  koffi@3.2.1 \
  node-pty@1.2.0-beta.15 \
  protobufjs@7.6.6; do
  npm install-scripts approve --prefix "$APP_ROOT" --allow-scripts-pin "$package"
done
if [[ ! -x "$APP_ROOT/node_modules/.bin/pnpm" ]] || \
  [[ "$($APP_ROOT/node_modules/.bin/pnpm --version)" != "$PNPM_VERSION" ]]; then
  npm install --prefix "$APP_ROOT" --save-exact "pnpm@$PNPM_VERSION"
fi
installed_proxy_version=''
if [[ -f "$APP_ROOT/node_modules/http-proxy/package.json" ]]; then
  installed_proxy_version="$(node -p "require('$APP_ROOT/node_modules/http-proxy/package.json').version")"
fi
if [[ "$installed_proxy_version" != "$HTTP_PROXY_VERSION" ]]; then
  npm install --prefix "$APP_ROOT" --save-exact "http-proxy@$HTTP_PROXY_VERSION"
fi
export PATH="$APP_ROOT/node_modules/.bin:$PATH"
(cd "$PACKAGE_ROOT/dsh-elysium-ui" && pnpm install --prod --frozen-lockfile --ignore-scripts)
install -m 0640 "$HARNESS_ROOT/config/proxy.mjs" "$APP_ROOT/proxy.mjs"

readonly DSH_BIN="$APP_ROOT/node_modules/.bin/dsh"
"$DSH_BIN" plugin --profile web add --workspace-root "$PACKAGE_ROOT/dsh-elysium-tools"
"$DSH_BIN" plugin --profile web add --workspace-root "$PACKAGE_ROOT/dsh-elysium-ui"
install -m 0640 "$HARNESS_ROOT/config/profile.patch.yml" "$HOME_ROOT/profiles/web/cordis.patch.yml"
install -m 0640 "$HARNESS_ROOT/config/settings.yaml" "$HOME_ROOT/settings.yaml"
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0640 \
  "$HARNESS_ROOT/config/operator-security.patch.yml" "$HOME_ROOT/operator-security.patch.yml"
if [[ ! -s "$PROXY_PASSWORD_FILE" ]]; then
  umask 077
  openssl rand -base64 24 >"$PROXY_PASSWORD_FILE"
fi
chmod 0600 "$PROXY_PASSWORD_FILE"
install -d -m 0750 "$HOME_ROOT/.agent-presets"
for preset in standard elysium-teaching elysium-free elysium-director; do
  if [[ ! -e "$HOME_ROOT/.agent-presets/$preset" ]]; then
    cp -R "$HARNESS_ROOT/.agent-presets/$preset" \
      "$HOME_ROOT/.agent-presets/"
  fi
done
# 服务器运维模式：用精简 composition 替换教学预设的 agent.cordis.yml，
# 仅保留 persona、skill-filesystem、tool-skill，禁用 bash/subagent 等危险工具。
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0640 \
  "$HARNESS_ROOT/config/operator-agent.cordis.yml" \
  "$HOME_ROOT/.agent-presets/elysium-teaching/agent.cordis.yml"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$HOME_ROOT"

install -d -m 0755 "$AUTOSTART_ROOT"
install -m 0644 "$HARNESS_ROOT/config/comfyui-autostart.py" "$AUTOSTART_ROOT/__init__.py"
chown root:root "$COMFYUI_ROOT"
chmod 0750 "$COMFYUI_ROOT"
chmod 0750 "$HARNESS_ROOT/start.sh" "$HARNESS_ROOT/qwen-tunnel.sh"

"$HARNESS_ROOT/start.sh" --restart
node --version
"$DSH_BIN" --version
echo "[DONE] Harness 已部署到 $HARNESS_ROOT"
