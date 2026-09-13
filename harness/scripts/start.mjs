#!/usr/bin/env node

import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createConnection } from 'node:net'

// 本机启动入口；服务器模型服务由独立脚本人工管理。
const dshHome = join(homedir(), '.dsh')
const harnessRunning = await new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port: 3080 })
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})

if (harnessRunning) {
  console.log('Harness 已在 http://127.0.0.1:3080 运行')
} else {
  execFileSync('dsh', ['web'], {
    env: { ...process.env, DSH_AGENTS_HOME: join(dshHome, 'agents'), DSH_HOME: dshHome },
    stdio: 'inherit',
  })
}
