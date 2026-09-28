import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveClientFile } from '../server/http/routes.js'

const clientRoot = fileURLToPath(new URL('../client/', import.meta.url))

function listClientFiles() {
  return readdirSync(clientRoot).filter(name => {
    const path = join(clientRoot, name)
    return statSync(path).isFile() && (name.endsWith('.js') || name.endsWith('.css'))
  })
}

test('client modules are flat files with javascript mime', () => {
  const files = listClientFiles()
  assert.ok(files.includes('session.js'))
  assert.ok(files.includes('library.js'))
  assert.equal(files.some(file => file.includes('/')), false)
  for (const file of files) {
    const resolved = resolveClientFile(file)
    assert.ok(resolved, file)
    assert.equal(resolved.type.startsWith(file.endsWith('.css') ? 'text/css' : 'text/javascript'), true, file)
  }
})

test('client file resolver rejects nested paths and traversal', () => {
  assert.equal(resolveClientFile('../index.js'), undefined)
  assert.equal(resolveClientFile('session/view.js'), undefined)
  assert.equal(resolveClientFile('session/../../index.js'), undefined)
  assert.equal(resolveClientFile('session/%2e%2e/index.js'), undefined)
})

test('shared domain modules are served from their own flat directory', () => {
  const sharedRoot = fileURLToPath(new URL('../shared/', import.meta.url))
  const files = readdirSync(sharedRoot).filter(name => name.endsWith('.js'))
  assert.ok(files.includes('drama-model.js'))
  for (const file of files) assert.equal(resolveClientFile(file, 'shared')?.path, join(sharedRoot, file), file)
  assert.equal(resolveClientFile('app.js').path, join(clientRoot, 'app.js'))
  assert.equal(resolveClientFile('../client/app.js', 'shared'), undefined)
  assert.equal(resolveClientFile('app.js', 'server'), undefined)
})

test('shared modules stay usable in the browser', async () => {
  const { readFile } = await import('node:fs/promises')
  const sharedRoot = fileURLToPath(new URL('../shared/', import.meta.url))
  for (const file of readdirSync(sharedRoot).filter(name => name.endsWith('.js'))) {
    const source = await readFile(join(sharedRoot, file), 'utf8')
    assert.doesNotMatch(source, /from ['"]node:/, `${file} must not import node: modules`)
    assert.doesNotMatch(source, /from ['"]\.\.\/(server|tools|client)\//, `${file} must only import shared modules`)
  }
})

// 浏览器按 /plugins/meiji/<dir>/<file> 加载模块：每个相对 import 都必须落在 client/ 或 shared/ 的平铺文件上。
test('every browser import resolves to a served flat file', async () => {
  const { readFile } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  const roots = { client: fileURLToPath(new URL('../client/', import.meta.url)), shared: fileURLToPath(new URL('../shared/', import.meta.url)) }
  for (const [dir, root] of Object.entries(roots)) {
    for (const file of readdirSync(root).filter(name => name.endsWith('.js'))) {
      const source = await readFile(join(root, file), 'utf8')
      for (const [, spec] of source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        if (!spec.startsWith('.') && !spec.startsWith('/plugins/meiji/')) continue
        const url = new URL(spec, `http://harness/plugins/meiji/${dir}/${file}`).pathname
        const match = /^\/plugins\/meiji\/(client|shared)\/([^/]+)$/.exec(url)
        assert.ok(match, `${dir}/${file} imports ${spec}, which the panel routes do not serve`)
        const resolved = resolveClientFile(match[2], match[1])
        assert.ok(resolved && existsSync(resolved.path), `${dir}/${file} imports missing ${url}`)
      }
    }
  }
})
