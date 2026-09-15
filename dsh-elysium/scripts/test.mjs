// 职责：运行公共测试及各已安装平台自带的测试，平台删除不留下固定导入。
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
async function tests(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.test.js')).map(entry => fileURLToPath(new URL(entry.name, directory)))
}
const files = await tests(new URL('tests/', root))
const providers = new URL('src/servers/providers/', root)
for (const entry of await readdir(providers, { withFileTypes: true })) {
  if (entry.isDirectory()) files.push(...await tests(new URL(`${entry.name}/tests/`, providers)))
}
const result = spawnSync(process.execPath, ['--test', ...files.sort()], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
