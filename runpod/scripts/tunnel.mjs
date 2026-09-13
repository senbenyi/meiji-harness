#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

// 服务器执行：建立到 Qwen 服务的 SSH 端口转发。
const target = process.argv[2]
if (target !== 'qwen') throw new Error('Usage: node runpod/scripts/tunnel.mjs qwen')

execFileSync('ssh', [
  '-f', '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=20',
  '-L', '127.0.0.1:18000:127.0.0.1:8000',
  'veo-qwen38',
], { stdio: 'inherit' })

console.log('Qwen 隧道已建立：http://127.0.0.1:18000/v1')
