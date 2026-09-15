#!/usr/bin/env node
// 职责：按服务器清单建立本机隧道，保留 qwen 旧入口，不接管无关进程。
import { ensureConnection, sshIdentity } from '../../dsh-elysium/src/servers/connection.js'
import { readRegistry } from '../../dsh-elysium/src/servers/store.js'
import { resolveServer } from '../../dsh-elysium/src/servers/resolve.js'
const target = process.argv[2], kind = process.argv[3] || 'comfyui'
if (!target) throw new Error('用法：node harness/scripts/tunnel.mjs qwen | <server-id> [comfyui|llm]')
let backend
if (target === 'qwen' && !readRegistry()) {
  backend = { server_id: 'legacy-qwen', instance_id: 'legacy', deployment_id: 'qwen', service: 'llm', base_url: 'http://127.0.0.1:18000/v1',
    connection: { transport: 'ssh', ssh_alias: 'veo-qwen38', ssh_identity: sshIdentity('veo-qwen38'), remote_host: '127.0.0.1', remote_port: 8000, local_port: 18000, api_path: '/v1' } }
} else backend = resolveServer(target === 'qwen' ? 'llm' : kind, target === 'qwen' ? undefined : target)
await ensureConnection(backend)
console.log(`连接已就绪：${backend.server_id} ${backend.base_url}`)
