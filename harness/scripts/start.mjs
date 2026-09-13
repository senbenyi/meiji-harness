#!/usr/bin/env node

// 职责：启动当前 DSH_HOME 的 Harness；只读取配置，不复制存储模板。
import { join } from 'node:path'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dshHome } from './storage-template.mjs'

const home = dshHome(), port = process.env.DSH_PORT
if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) throw new Error('DSH_PORT 必须为 0–65535 的端口号')
const tunnelScript = fileURLToPath(new URL('./tunnel.mjs', import.meta.url))
if (process.env.DSH_SKIP_TUNNEL !== '1') {
  try { execFileSync(process.execPath, [tunnelScript, 'qwen'], { stdio: 'inherit' }) }
  catch { console.warn('Qwen 隧道启动失败，继续启动 Harness') }
}
const harnessPort = port ?? '3080'
if (harnessPort !== '0') {
  try {
    const response = await fetch(`http://127.0.0.1:${harnessPort}/`, { signal: AbortSignal.timeout(1000) })
    const body = await response.text()
    if (response.status === 401 && body.includes('dsh web authentication required')) {
      console.log(`Harness 已在运行：http://127.0.0.1:${harnessPort}/`)
      process.exit(0)
    }
  } catch {}
}
const logDirectory = join(home, 'logs'), harnessLog = join(logDirectory, 'harness-local.log')
await mkdir(logDirectory, { recursive: true })
const log = openSync(harnessLog, 'a')
const harness = spawn('dsh', ['web', ...(process.env.DSH_NO_OPEN === '1' ? ['--no-open'] : []), ...(port === undefined ? [] : ['--port', port])], {
  detached: true, env: { ...process.env, DSH_AGENTS_HOME: join(home, 'agents'), DSH_HOME: home }, stdio: ['ignore', log, log],
})
let spawnError
harness.on('error', error => { spawnError = error })
harness.unref()
closeSync(log)

// 从本次启动进程读取实际监听地址，避免依赖默认端口或终止其他实例。
for (let attempt = 0; attempt < 300; attempt++) {
  if (spawnError) throw spawnError
  if (harness.exitCode !== null) throw new Error(`Harness 启动失败，退出码 ${harness.exitCode}；查看 ${harnessLog}`)
  try {
    const listeners = execFileSync('lsof', ['-nP', '-a', '-p', String(harness.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const actualPort = /^n.*:(\d+)$/m.exec(listeners)?.[1]
    if (actualPort) { console.log(`Harness 已在后台启动：http://127.0.0.1:${actualPort}/（PID：${harness.pid}；日志：${harnessLog}）`); process.exit(0) }
  } catch (error) { if (error.status !== 1) throw error }
  await delay(100)
}
process.kill(harness.pid, 'SIGTERM')
throw new Error(`Harness 启动超时；查看 ${harnessLog}`)
