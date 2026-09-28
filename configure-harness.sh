#!/usr/bin/env bash
# Link the meiji plugin into a sibling DeepSeek Harness checkout and start the web UI.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$REPO/meiji"
ROOT="$(cd "$REPO/.." && pwd)"
HARNESS="${HARNESS_DIR:-$ROOT/deepseek-harness}"
HARNESS_URL="https://github.com/deepseek-ai/deepseek-harness.git"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js ^22.19.0 或 >=24" >&2
  exit 1
fi
node -e '
const [major, minor] = process.versions.node.split(".").map(Number)
const ok = (major === 22 && minor >= 19) || major >= 24
if (!ok) {
  console.error("需要 Node.js ^22.19.0 或 >=24，当前 " + process.versions.node)
  process.exit(1)
}
'

if [[ ! -f "$PLUGIN/package.json" ]]; then
  echo "找不到 meiji 插件: $PLUGIN" >&2
  exit 1
fi

node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs"
const file = process.argv[1]
const manifest = JSON.parse(readFileSync(file, "utf8"))
manifest.dsh = { bundle: { patch: "./cordis.patch.yml" } }
writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
' "$PLUGIN/package.json"

cat > "$PLUGIN/cordis.patch.yml" <<'EOF'
- insert:
    - id: meiji
      name: '@meiji/harness-plugin'
EOF

if [[ ! -d "$HARNESS/.git" ]]; then
  echo "克隆 DeepSeek Harness 到 $HARNESS"
  git clone "$HARNESS_URL" "$HARNESS"
fi

cd "$HARNESS"
if [[ ! -x node_modules/.bin/pnpm ]]; then
  echo "安装 Harness 依赖"
  npx --yes pnpm@11.7.0 install
fi
if [[ ! -d apps/web/dist ]]; then
  echo "构建 Harness"
  node_modules/.bin/pnpm run build
fi

export PATH="$HARNESS/node_modules/.bin:$PATH"
echo "链接 meiji 插件"
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add "$PLUGIN"

if node -e 'const n=require("net").connect(3080,"127.0.0.1",()=>{n.end();process.exit(0)});n.on("error",()=>process.exit(1))'; then
  echo "Harness 已在 http://127.0.0.1:3080 运行"
  exit 0
fi

echo "启动 Harness"
exec node --import tsx/esm apps/cli/src/bin.ts web
