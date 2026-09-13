#!/usr/bin/env node

import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// 本机启动入口；服务器模型服务由独立脚本人工管理。
const dshHome = join(homedir(), '.dsh')
const tunnelScript = fileURLToPath(new URL('./tunnel.mjs', import.meta.url))

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
execFileSync('dsh', ['web'], {
  env: { ...process.env, DSH_AGENTS_HOME: join(dshHome, 'agents'), DSH_HOME: dshHome },
  stdio: 'inherit',
})
