import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'

const files = ['package.json', 'pnpm-lock.yaml', 'dsh.plugin.json', 'cordis.patch.yml', 'lib', 'README.md', 'config']
for (const file of files) {
  if (!existsSync(file)) throw new Error(`缺少 ${file}，请先运行 pnpm build`)
}
rmSync('registry', { recursive: true, force: true })
mkdirSync('registry')
for (const file of files) cpSync(file, `registry/${file}`, { recursive: true })
