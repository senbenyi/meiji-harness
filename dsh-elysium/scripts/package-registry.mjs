// 职责：校验构建产物，并组装 Registry 发布目录。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const files = ['package.json', 'lib', 'README.md']

for (const file of files) {
  if (!existsSync(file)) throw new Error(`missing ${file}; run pnpm build first`)
}
rmSync('registry', { recursive: true, force: true })
mkdirSync('registry', { recursive: true })
for (const file of files) {
  const target = join('registry', file)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(file, target, { recursive: true })
}
console.log(`registry assembled (${files.length} files)`)
