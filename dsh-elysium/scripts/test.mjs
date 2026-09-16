// 职责：运行 tests/ 下统一维护的全部插件测试。
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
async function tests(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.test.js')).map(entry => fileURLToPath(new URL(entry.name, directory)))
}
const files = await tests(new URL('tests/', root))
const result = spawnSync(process.execPath, ['--test', ...files.sort()], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
