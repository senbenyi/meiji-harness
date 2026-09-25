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
