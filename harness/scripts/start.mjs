#!/usr/bin/env node

// 职责：停止同端口的本机 Harness，并使用当前 DSH_HOME 配置重新启动 Harness。
import { join, isAbsolute, parse, resolve } from 'node:path'
import { homedir } from 'node:os'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

function dshHome(value = process.env.DSH_HOME) {
  if (value === undefined) return join(homedir(), '.dsh')
  if (!value.trim() || !isAbsolute(value) || resolve(value) === parse(value).root || resolve(value) === homedir()) throw new Error('DSH_HOME 必须为独立的绝对目录，不能是根目录或用户主目录')
  return resolve(value)
}

const home = dshHome(), port = process.env.DSH_PORT
if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) throw new Error('DSH_PORT 必须为 0–65535 的端口号')
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
const logDirectory = join(home, 'logs'), harnessLog = join(logDirectory, 'harness-local.log')
await mkdir(logDirectory, { recursive: true })
const log = openSync(harnessLog, 'w')
const harness = spawn('dsh', ['web', ...(process.env.DSH_NO_OPEN === '1' ? ['--no-open'] : []), ...(port === undefined ? [] : ['--port', port])], {
  detached: true, env: { ...process.env, DSH_AGENTS_HOME: join(home, 'agents'), DSH_HOME: home, QWEN38_LOCAL_API_KEY: process.env.QWEN38_LOCAL_API_KEY || 'local-vllm' }, stdio: ['ignore', log, log],
})
let spawnError
harness.on('error', error => { spawnError = error })
harness.unref()
closeSync(log)

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
