#!/usr/bin/env node

// 职责：停止已有 Harness，应用待生效模型选择并启动当前 DSH_HOME 的 Harness，不复制存储模板。
import { join } from 'node:path'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { applyLlmSelection } from './server-startup.mjs'
import { readRegistry, providerEnvironment, defaultTunnelAlias } from '../../dsh-elysium/src/servers/runtime/index.js'
import { dshHome } from './storage-template.mjs'

const home = dshHome(), port = process.env.DSH_PORT
const providerEnv = providerEnvironment(home, fileURLToPath(new URL('../.dsh/', import.meta.url)))
if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) throw new Error('DSH_PORT 必须为 0–65535 的端口号')
const tunnelScript = fileURLToPath(new URL('./tunnel.mjs', import.meta.url))
const harnessPort = port ?? '3080'
if (harnessPort !== '0') {
  let running = false
  try {
    const response = await fetch(`http://127.0.0.1:${harnessPort}/`, { signal: AbortSignal.timeout(1000) })
    const body = await response.text()
    running = response.status === 401 && body.includes('dsh web authentication required')
  } catch {}
  if (running) {
    console.log(`Harness 已在运行，正在停止并重新启动：http://127.0.0.1:${harnessPort}/`)
    const pids = [...new Set(execFileSync('lsof', ['-nP', `-iTCP:${harnessPort}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/).map(Number))]
    // 先卸载托管旧进程的 launchd 服务，避免 KeepAlive 立即拉起并抢占端口。
    if (process.platform === 'darwin') {
      const services = execFileSync('launchctl', ['list'], { encoding: 'utf8' })
      for (const line of services.trim().split('\n')) {
        const [pid, , label] = line.trim().split(/\s+/)
        if (pids.includes(Number(pid))) execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'inherit' })
      }
    }
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    // 等待旧进程退出后再应用模型配置；超时则强制终止。
    for (let attempt = 0; ; attempt++) {
      const alive = pids.filter(pid => {
        try { process.kill(pid, 0); return true } catch (error) { if (error.code !== 'ESRCH') throw error; return false }
      })
      if (!alive.length) break
      if (attempt === 50) for (const pid of alive) {
        try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
      if (attempt === 100) throw new Error(`Harness 旧进程未退出：${alive.join(', ')}`)
      await delay(100)
    }
  }
}
const registry = readRegistry()
if (process.env.DSH_SKIP_TUNNEL !== '1') {
  if (registry) {
    for (const server of registry.servers) for (const [kind, service] of Object.entries(server.services)) {
      if (service.transport === 'ssh' && registry.active[kind] === server.id) execFileSync(process.execPath, [tunnelScript, server.id, kind], { stdio: 'inherit' })
    }
  } else {
    try { execFileSync(process.execPath, [tunnelScript, defaultTunnelAlias()], { stdio: 'inherit' }) }
    catch { console.warn('默认文本隧道启动失败，继续启动 Harness') }
  }
}
const appliedLlm = await applyLlmSelection(home)
const logDirectory = join(home, 'logs'), harnessLog = join(logDirectory, 'harness-local.log')
await mkdir(logDirectory, { recursive: true })
const log = openSync(harnessLog, 'a')
const harness = spawn('dsh', ['web', ...(process.env.DSH_NO_OPEN === '1' ? ['--no-open'] : []), ...(port === undefined ? [] : ['--port', port])], {
  detached: true, env: { ...process.env, DSH_AGENTS_HOME: join(home, 'agents'), DSH_HOME: home, ...providerEnv, ELYSIUM_LLM_SERVER_ID: appliedLlm?.server_id || '' }, stdio: ['ignore', log, log],
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
