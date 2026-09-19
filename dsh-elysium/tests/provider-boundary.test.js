// 职责：强制提供者内聚和唯一调用入口，阻止公共层重新引入平台分支。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, access } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url), entry = new URL('src/worker/models/managers/runtime/index.js', root).href
async function sourceFiles(directory) {
  const files = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(item.name + (item.isDirectory() ? '/' : ''), directory)
    if (item.isDirectory()) files.push(...await sourceFiles(url))
    else if (/\.(js|mjs|json)$/.test(item.name)) files.push(url)
  }
  return files
}
const imports = source => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
test('production callers use the sole runtime entry and contain no provider names, model rules or raw adapters', async () => {
  const files = [...await sourceFiles(new URL('src/', root)), ...await sourceFiles(new URL('scripts/', root)), ...await sourceFiles(new URL('../harness/scripts/', root))]
  for (const file of files) {
    if (file.pathname.includes('/src/worker/models/')) continue
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /\b(?:runpod|byteplus|bailian|seedance|seedream|autodl|wan2|qwen38|minimax-h3)\b/i, file.pathname)
    assert.doesNotMatch(source, /\b(?:providerFor|loadProvider)\b/, file.pathname)
    for (const specifier of imports(source)) {
      if (!specifier.startsWith('.')) continue
      const target = new URL(specifier, file)
      const dataSchema = file.pathname.includes('/src/database/') && target.pathname.endsWith('/schema.js')
      if (!dataSchema && (target.pathname.includes('/src/worker/models/managers/') || target.pathname.includes('/src/worker/models/providers/'))) assert.equal(target.href, entry, `${file.pathname}: ${specifier}`)
    }
  }
  await assert.rejects(access(new URL('../runpod/', root)), { code: 'ENOENT' })
})
test('providers own their declarations and never directly import sibling implementations', async () => {
  const directory = new URL('src/worker/models/providers/', root)
  for (const file of await sourceFiles(directory)) {
    assert.equal(file.pathname.includes('/tests/'), false, `${file.pathname}: provider tests must live in tests/`)
    if (file.pathname.includes('/legacy/') || file.pathname.includes('/resources/')) continue
    const source = await readFile(file, 'utf8')
    const owner = relative(fileURLToPath(directory), fileURLToPath(file)).split('/')[0]
    for (const specifier of imports(source)) {
      if (!specifier.startsWith('.')) continue
      const target = new URL(specifier, file)
      if (!target.href.startsWith(directory.href)) continue
      const targetOwner = relative(fileURLToPath(directory), fileURLToPath(target)).split('/')[0]
      assert.equal(targetOwner, owner, `${file.pathname}: sibling dependency ${specifier}`)
    }
  }
})

test('the public entry exposes operations, not raw provider instances or loaders', async () => {
  const api = await import('../src/worker/models/managers/runtime/index.js')
  assert.equal(api.providerFor, undefined)
  assert.equal(api.loadProvider, undefined)
  for (const name of ['validateBackendPlan', 'executeBackendJob', 'extractBackendReference', 'resolveGenerationBackend', 'probeBackend', 'syncProviderWorkflows']) assert.equal(typeof api[name], 'function')
})

test('routing internals do not hard-code provider identities or model specifications', async () => {
  for (const file of await sourceFiles(new URL('src/worker/models/managers/', root))) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /\b(?:runpod|byteplus|bailian|seedance|seedream|autodl|wan2|qwen38|minimax-h3)\b/i, file.pathname)
    assert.doesNotMatch(source, /provider\s*:\s*['"]manual['"]/, file.pathname)
  }
})
