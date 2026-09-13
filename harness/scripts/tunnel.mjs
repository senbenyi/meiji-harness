#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

// 服务器执行：建立到 Qwen 服务的 SSH 端口转发。
const target = process.argv[2]
if (target !== 'qwen') throw new Error('Usage: node harness/scripts/tunnel.mjs qwen')

try {
  const response = await fetch('http://127.0.0.1:18000/v1/models', { signal: AbortSignal.timeout(1000) })
  if (response.ok) {
    console.log('Qwen 隧道已在运行：http://127.0.0.1:18000/v1')
    process.exit(0)
  }
} catch {}

const result = spawnSync('ssh', [
  '-f', '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=20',
  '-L', '127.0.0.1:18000:127.0.0.1:8000',
  'veo-qwen38',
], { stdio: 'inherit' })

if (result.status !== 0) process.exit(result.status ?? 1)
console.log('Qwen 隧道已建立：http://127.0.0.1:18000/v1')
