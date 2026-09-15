#!/usr/bin/env node
// 职责：在模型服务器上显式调用指定平台的服务管理，不启动 Harness。
import { manageProvider } from '../src/servers/runtime/index.js'
const [provider, action] = process.argv.slice(2)
if (!provider || !action) throw new Error('用法：node scripts/server-service.mjs <provider> <check|start|stop|restart>')
console.log(JSON.stringify(await manageProvider(provider, action)))
