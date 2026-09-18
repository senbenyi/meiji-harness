// 职责：从 src/ 构建 lib/，并生成适配 Harness 的客户端代码。
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { clientSource } from './loader.js'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })
cpSync('src', 'lib', { recursive: true })
// 平台历史材料只在源码仓库中维护，不进入运行包。
for (const entry of readdirSync('lib/models/providers', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  for (const name of ['legacy', 'resources']) rmSync(`lib/models/providers/${entry.name}/${name}`, { recursive: true, force: true })
}
rmSync('lib/client', { recursive: true, force: true })
writeFileSync('lib/client.js', clientSource())
console.log('built lib/ from src/')
