import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveClientFile } from '../server/http/panel-routes.js'

const clientRoot = fileURLToPath(new URL('../client/', import.meta.url))

function listClientFiles() {
  return readdirSync(clientRoot).filter(name => {
    const path = join(clientRoot, name)
    return statSync(path).isFile() && (name.endsWith('.js') || name.endsWith('.css'))
  })
}

test('client modules are flat files with javascript mime', () => {
  const files = listClientFiles()
  assert.ok(files.includes('project-session-view.js'))
  assert.ok(files.includes('asset-library-view.js'))
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
  assert.equal(files.includes('drama-model.js'), false)
  for (const file of files) assert.equal(resolveClientFile(file, 'shared')?.path, join(sharedRoot, file), file)
  assert.equal(resolveClientFile('panel-app.js').path, join(clientRoot, 'panel-app.js'))
  assert.equal(resolveClientFile('../client/panel-app.js', 'shared'), undefined)
  assert.equal(resolveClientFile('panel-app.js', 'server'), undefined)
})

test('shared modules stay usable in the browser', async () => {
  const { readFile } = await import('node:fs/promises')
  const sharedRoot = fileURLToPath(new URL('../shared/', import.meta.url))
  for (const file of readdirSync(sharedRoot).filter(name => name.endsWith('.js'))) {
    const source = await readFile(join(sharedRoot, file), 'utf8')
    assert.doesNotMatch(source, /from ['"]node:/, `${file} must not import node: modules`)
    assert.doesNotMatch(source, /from ['"]\.\.\/(tools|client)\//, `${file} must not import tools or client`)
    assert.doesNotMatch(source, /from ['"]\.\.\/server\/(?!models\/(data|tasks)\/)/, `${file} must only import shared modules or data/task models`)
  }
})

// 浏览器按 /plugins/meiji/<dir>/<file> 加载模块。client、shared 是平铺目录；数据与任务 model 在 server/models 下按类各一层。
test('every browser import resolves to a served flat file', async () => {
  const { readFile } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  const roots = [
    ['client', fileURLToPath(new URL('../client/', import.meta.url)), 'client'],
    ['shared', fileURLToPath(new URL('../shared/', import.meta.url)), 'shared'],
    ['models-data', fileURLToPath(new URL('../server/models/data/', import.meta.url)), 'server/models/data'],
    ['models-tasks', fileURLToPath(new URL('../server/models/tasks/', import.meta.url)), 'server/models/tasks'],
  ]
  const targetOf = url => {
    const flat = /^\/plugins\/meiji\/(client|shared)\/([^/]+)$/.exec(url)
    if (flat) return { dir: flat[1], file: flat[2] }
    const model = /^\/plugins\/meiji\/server\/models\/(data|tasks)\/([^/]+)$/.exec(url)
    if (model) return { dir: model[1] === 'data' ? 'models-data' : 'models-tasks', file: model[2] }
  }
  for (const [dir, root, urlDir] of roots) {
    for (const file of readdirSync(root).filter(name => name.endsWith('.js'))) {
      const source = await readFile(join(root, file), 'utf8')
      assert.doesNotMatch(source, /from ['"]node:/, `${urlDir}/${file} must not import node: modules`)
      for (const [, spec] of source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        if (!spec.startsWith('.') && !spec.startsWith('/plugins/meiji/')) continue
        const url = new URL(spec, `http://harness/plugins/meiji/${urlDir}/${file}`).pathname
        const match = targetOf(url)
        assert.ok(match, `${urlDir}/${file} imports ${spec}, which the panel routes do not serve`)
        const resolved = resolveClientFile(match.file, match.dir)
        assert.ok(resolved && existsSync(resolved.path), `${urlDir}/${file} imports missing ${url}`)
      }
    }
  }
})
