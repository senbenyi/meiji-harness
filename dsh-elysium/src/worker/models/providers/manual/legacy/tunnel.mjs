#!/usr/bin/env node
// 职责：兼容旧 Qwen 隧道命令，通过唯一入口连接已声明的兼容后端。
import { connectBackend, legacyTunnelBackend } from '../../../index.js'
const backend = legacyTunnelBackend(process.argv[2])
if (!backend) throw new Error('需要已声明的兼容隧道别名')
await connectBackend(backend)
