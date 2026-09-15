#!/usr/bin/env node
// 职责：兼容旧 Qwen 隧道命令；连接服务由本机公共入口按登记平台解析。
const target = process.argv[2]
if (target !== 'qwen') throw new Error('Usage: node runpod/scripts/tunnel.mjs qwen')
await import('../../harness/scripts/tunnel.mjs')
