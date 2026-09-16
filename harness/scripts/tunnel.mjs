#!/usr/bin/env node
// 职责：按服务器清单建立本机隧道，保留已声明的兼容入口，不接管无关进程。
import { connectBackend, legacyTunnelBackend, resolveServer } from '../../dsh-elysium/src/servers/runtime/index.js'
const target = process.argv[2], kind = process.argv[3] || 'comfyui'
if (!target) throw new Error('用法：node harness/scripts/tunnel.mjs <兼容别名或server-id> [comfyui|llm]')
const backend = legacyTunnelBackend(target) || resolveServer(kind, target)
await connectBackend(backend)
console.log(`连接已就绪：${backend.server_id} ${backend.base_url}`)
