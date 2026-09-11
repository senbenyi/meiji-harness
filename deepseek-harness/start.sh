#!/usr/bin/env bash
set -Eeuo pipefail

readonly HARNESS_ROOT=/workspace/harness
readonly NODE_ROOT="$HARNESS_ROOT/runtime/node-v24.20.0-linux-x64"
readonly DSH_HOME="$HARNESS_ROOT/home"
readonly DSH_BIN="$HARNESS_ROOT/app/node_modules/.bin/dsh"
readonly HARNESS_PORT=8889
readonly PUBLIC_PORT=8888
readonly TRUSTED_HOST=36we4j3zo503js-8888.proxy.runpod.net
readonly HARNESS_PID_FILE="$HARNESS_ROOT/harness.pid"
readonly PROXY_PID_FILE="$HARNESS_ROOT/proxy.pid"
readonly LOG_FILE="$HARNESS_ROOT/logs/harness.log"
readonly PROXY_LOG_FILE="$HARNESS_ROOT/logs/proxy.log"
readonly PROXY_PASSWORD_FILE="$HARNESS_ROOT/config/proxy-password"
readonly HARNESS_TOKEN_FILE="$HARNESS_ROOT/config/harness-token"
readonly PROXY_ENTRY="$HARNESS_ROOT/app/proxy.mjs"
readonly QWEN_TUNNEL_ENTRY="$HARNESS_ROOT/qwen-tunnel.sh"

umask 077
export PATH="$NODE_ROOT/bin:$HARNESS_ROOT/app/node_modules/.bin:$PATH"

fail() { echo "[FAIL] $1" >&2; exit 1; }
http_code() {
  curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true
}
harness_ready() {
  local code
  code="$(http_code "http://127.0.0.1:$HARNESS_PORT/")"
  [[ "$code" =~ ^[1-4][0-9][0-9]$ ]]
}
proxy_ready() {
  [[ "$(http_code "http://127.0.0.1:$PUBLIC_PORT/")" == 401 ]]
}
running_pid() {
  local pid_file="$1" expected="$2"
  [[ -s "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  tr '\0' ' ' <"/proc/$pid/cmdline" | grep -Fq "$expected"
  printf '%s\n' "$pid"
}
stop_pid() {
  local pid_file="$1" expected="$2" pid
  pid="$(running_pid "$pid_file" "$expected" || true)"
  [[ -n "$pid" ]] || return 0
  kill -TERM "$pid"
  for _ in {1..30}; do
    kill -0 "$pid" 2>/dev/null || { rm -f "$pid_file"; return 0; }
    sleep 1
  done
  fail "PID $pid 未停止"
}
stop() {
  stop_pid "$PROXY_PID_FILE" proxy.mjs
  stop_pid "$HARNESS_PID_FILE" "$DSH_BIN"
  "$QWEN_TUNNEL_ENTRY" --stop
}

action="${1:-start}"
[[ "$action" == start || "$action" == --restart || "$action" == --stop ]] || \
  fail 'Usage: start.sh [--restart|--stop]'
[[ -x "$DSH_BIN" ]] || fail "Harness 未安装：$DSH_BIN"
[[ -s "$PROXY_PASSWORD_FILE" ]] || fail '代理密码不存在，请重新执行 deploy.sh'
[[ -s "$PROXY_ENTRY" ]] || fail '代理入口不存在，请重新执行 deploy.sh'
[[ -x "$QWEN_TUNNEL_ENTRY" ]] || fail 'Qwen 隧道入口不存在，请重新执行 deploy.sh'
install -d -m 0750 "$HARNESS_ROOT/logs"

if [[ "$action" == --stop ]]; then
  stop
  echo '[DONE] Harness 已停止'
  exit 0
fi
if [[ "$action" == --restart ]]; then
  stop
else
  "$QWEN_TUNNEL_ENTRY"
fi
if [[ "$action" != --restart ]] && running_pid "$HARNESS_PID_FILE" "$DSH_BIN" >/dev/null && \
  running_pid "$PROXY_PID_FILE" proxy.mjs >/dev/null && harness_ready && proxy_ready; then
  echo "[OK] Harness 已运行：http://127.0.0.1:$PUBLIC_PORT/"
  exit 0
fi

cd /workspace
: >"$LOG_FILE"
: >"$PROXY_LOG_FILE"
[[ "$action" != --restart ]] || "$QWEN_TUNNEL_ENTRY"
nohup env DSH_HOME="$DSH_HOME" QWEN38_LOCAL_API_KEY=local-vllm "$DSH_BIN" --profile web \
  --host 127.0.0.1 --port "$HARNESS_PORT" --no-open \
  --trusted-host "$TRUSTED_HOST" >>"$LOG_FILE" 2>&1 </dev/null &
harness_pid=$!
printf '%s\n' "$harness_pid" >"$HARNESS_PID_FILE"
for _ in {1..60}; do
  kill -0 "$harness_pid" 2>/dev/null || fail "Harness 已退出，查看 $LOG_FILE"
  harness_ready && break
  sleep 1
done
harness_ready || fail "Harness 启动超时，查看 $LOG_FILE"
sleep 3
kill -0 "$harness_pid" 2>/dev/null || fail "Harness 插件加载失败，查看 $LOG_FILE"
token="$(sed -n 's#.*?token=##p' "$LOG_FILE" | tail -n 1)"
[[ "$token" =~ ^[A-Za-z0-9_-]+$ ]] || fail '无法从 Harness 启动日志读取访问 token'
printf '%s\n' "$token" >"$HARNESS_TOKEN_FILE"
chmod 0600 "$HARNESS_TOKEN_FILE" "$LOG_FILE"

nohup env \
  HARNESS_PROXY_PASSWORD_FILE="$PROXY_PASSWORD_FILE" \
  HARNESS_TOKEN_FILE="$HARNESS_TOKEN_FILE" \
  HARNESS_PUBLIC_HOST="$TRUSTED_HOST" \
  HARNESS_TARGET="http://127.0.0.1:$HARNESS_PORT" \
  HARNESS_PUBLIC_PORT="$PUBLIC_PORT" \
  "$HARNESS_ROOT/runtime/node-v24.20.0-linux-x64/bin/node" \
  "$PROXY_ENTRY" >>"$PROXY_LOG_FILE" 2>&1 </dev/null &
proxy_pid=$!
printf '%s\n' "$proxy_pid" >"$PROXY_PID_FILE"
chmod 0600 "$PROXY_LOG_FILE"
for _ in {1..30}; do
  kill -0 "$proxy_pid" 2>/dev/null || fail "代理已退出，查看 $PROXY_LOG_FILE"
  if proxy_ready; then
    echo "[DONE] Harness 已启动：http://127.0.0.1:$PUBLIC_PORT/"
    exit 0
  fi
  sleep 1
done
fail "代理启动超时，查看 $PROXY_LOG_FILE"
