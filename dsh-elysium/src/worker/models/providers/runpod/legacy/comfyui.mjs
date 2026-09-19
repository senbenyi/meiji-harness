#!/usr/bin/env node
// 职责：保留 Runpod 服务端运维命令，具体实现由平台模块拥有。
import { manageProvider } from '../../../index.js'
const action = process.argv[2]
if (!action) throw new Error('Usage: node runpod/scripts/comfyui.mjs <check|start|stop|restart>')
console.log(JSON.stringify(await manageProvider('runpod', action)))
