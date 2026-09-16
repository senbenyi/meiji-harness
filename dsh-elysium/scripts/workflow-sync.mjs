#!/usr/bin/env node
// 职责：按平台配置路由工作流同步；模板与编译器由所选平台提供。
import { syncProviderWorkflows, resolveServer } from '../src/servers/runtime/index.js'
import { resolveConfig, withConfig } from '../src/config.js'
const args = process.argv.slice(2), index = args.indexOf('--provider')
const id = index < 0 ? withConfig(resolveConfig(), () => resolveServer().provider) : args[index + 1]
await syncProviderWorkflows(id, args)
