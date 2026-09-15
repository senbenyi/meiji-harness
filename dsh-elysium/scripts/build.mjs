// 职责：从 src/ 构建 lib/，并生成适配 Harness 的客户端代码。
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { clientSource } from './client-source.mjs'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })
cpSync('src', 'lib', { recursive: true })
rmSync('lib/client', { recursive: true, force: true })
rmSync('lib/business/video-production', { recursive: true, force: true })
writeFileSync('lib/client.js', clientSource())
console.log('built lib/ from src/')
