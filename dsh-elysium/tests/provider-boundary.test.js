// 职责：阻止平台专属路径或实现重新进入公共业务、模型协议和界面。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, access } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
async function sourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) files.push(...await sourceFiles(url))
    else if (/\.(js|mjs|json|md)$/.test(entry.name)) files.push(url)
  }
  return files
}
test('shared business and model code contain no platform implementation or instance paths', async () => {
  for (const directory of ['business', 'comfyui', 'tools', 'client', 'prompts']) {
    for (const file of await sourceFiles(new URL(`src/${directory}/`, root))) {
      const source = await readFile(file, 'utf8')
      assert.doesNotMatch(source, /runpod/i, file.pathname)
      assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"][^'"]*servers\/providers\//, file.pathname)
    }
  }
  await assert.rejects(access(new URL('../runpod/', root)), { code: 'ENOENT' })
})
