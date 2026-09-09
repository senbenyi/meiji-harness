import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const files = ['package.json', 'cordis.patch.yml', 'dsh.plugin.json', 'lib', 'presets', 'README.md']

rmSync('registry', { recursive: true, force: true })
mkdirSync('registry', { recursive: true })
for (const file of files) {
  if (!existsSync(file)) throw new Error(`missing ${file}; run pnpm build first`)
  const target = join('registry', file)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(file, target, { recursive: true })
}
console.log(`registry assembled (${files.length} files)`)
