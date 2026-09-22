// 职责：核对同名运行时 Skill 文件与仓库模板；显式同步时以运行时内容覆盖模板。
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, readdir, mkdir, writeFile } from '../src/database/files.js'
import { defaultElysiumHome } from '../src/database/paths.js'

const mode = process.argv[2]
if (!['--check', '--sync'].includes(mode) || process.argv.length !== 3) throw new Error('用法：skills-sync.mjs --check|--sync')
const runtime = join(defaultElysiumHome(), 'pools', 'skills')
const template = fileURLToPath(new URL('../../harness/.dsh/storages/elysium/pools/skills/', import.meta.url))

async function files(root, relative = '') {
  const entries = await readdir(join(root, relative), { withFileTypes: true })
  const nested = await Promise.all(entries.filter(entry => !entry.name.startsWith('.')).map(async entry => {
    const path = join(relative, entry.name)
    return entry.isDirectory() ? files(root, path) : entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  }))
  return nested.flat()
}

const templateSkills = new Set((await readdir(template, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name))
const common = (await files(runtime)).filter(path => templateSkills.has(path.split('/')[0]))
const differences = []
for (const path of common) {
  const content = await readFile(join(runtime, path))
  const current = await readFile(join(template, path)).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (current?.equals(content)) continue
  differences.push(path)
  if (mode === '--sync') {
    await mkdir(dirname(join(template, path)), { recursive: true })
    await writeFile(join(template, path), content)
  }
}
console.log(`${mode === '--sync' ? '已同步' : '差异'} ${differences.length} 个同名 Skill 文件`)
for (const path of differences) console.log(path)
if (mode === '--check' && differences.length) process.exitCode = 1
