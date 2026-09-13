#!/usr/bin/env node

import { homedir } from 'node:os'
import { join } from 'node:path'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// 本机启动入口；服务器模型服务由独立脚本人工管理。
const dshHome = join(homedir(), '.dsh')
const tunnelScript = fileURLToPath(new URL('./tunnel.mjs', import.meta.url))
const logDirectory = join(dshHome, 'logs')
const harnessLog = join(logDirectory, 'harness-local.log')

// 获取指定端口的监听进程。
const listenerPids = port => {
  try {
    return execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  } catch (error) {
    if (error.status !== 1) throw error
    return []
  }
}

// 终止端口上的旧进程并等待端口释放。
const stopListeners = async (port, name) => {
  const pids = listenerPids(port)
  if (!pids.length) return
  console.log(`正在重启 ${name}`)
  for (const pid of pids) process.kill(Number(pid), 'SIGKILL')
  for (let attempt = 0; attempt < 10 && listenerPids(port).length; attempt += 1) await delay(100)
  if (listenerPids(port).length) throw new Error(`${name} 旧进程未能退出`)
}

await stopListeners(18000, 'Qwen 隧道')
try {
  execFileSync(process.execPath, [tunnelScript, 'qwen'], { stdio: 'inherit' })
} catch {
  console.warn('Qwen 隧道启动失败，继续启动 Harness')
}

await stopListeners(3080, 'Harness')
await mkdir(logDirectory, { recursive: true })
const log = openSync(harnessLog, 'a')
const harness = spawn('dsh', ['web'], {
  detached: true,
  env: { ...process.env, DSH_AGENTS_HOME: join(dshHome, 'agents'), DSH_HOME: dshHome },
  stdio: ['ignore', log, log],
})
harness.unref()
closeSync(log)

for (let attempt = 0; attempt < 100 && !listenerPids(3080).length; attempt += 1) {
  if (harness.exitCode !== null) throw new Error(`Harness 启动失败，退出码 ${harness.exitCode}；查看 ${harnessLog}`)
  await delay(100)
}
if (!listenerPids(3080).length) {
  process.kill(harness.pid, 'SIGKILL')
  throw new Error(`Harness 启动超时；查看 ${harnessLog}`)
}
console.log(`Harness 已在后台启动：http://127.0.0.1:3080/（日志：${harnessLog}）`)
