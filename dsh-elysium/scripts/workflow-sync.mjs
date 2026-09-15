#!/usr/bin/env node
// 职责：按平台配置路由工作流同步；模板与编译器由所选平台提供。
import { loadProvider } from '../src/servers/runtime/loader.js'
import { resolveServer } from '../src/servers/registry/resolve.js'
import { resolveConfig, withConfig } from '../src/config.js'
const args = process.argv.slice(2), index = args.indexOf('--provider')
const id = index < 0 ? withConfig(resolveConfig(), () => resolveServer().provider) : args[index + 1]
const provider = await loadProvider(id)
if (typeof provider.syncWorkflows !== 'function') throw new Error('所选平台未提供工作流同步')
await provider.syncWorkflows(args)
