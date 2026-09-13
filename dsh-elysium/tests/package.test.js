import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { clientSource } from '../scripts/client-source.mjs'

test('browser bundle registers the exact package name required by Harness', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const registrations = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load(entry) {
    assert.equal(registrations.has(entry.id), false, `Duplicate module: ${entry.id}`)
    registrations.set(entry.id, entry.factory)
  } } } })
  assert.equal(typeof registrations.get(pkg.name), 'function')
})

test('Harness can resolve the server and declared client entries', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  for (const [subpath, target] of [['', 'lib/index.js'], ['/client', 'lib/client.js'], ['/package.json', 'package.json']]) {
    assert.equal(import.meta.resolve(`${pkg.name}${subpath}`), new URL(`../${target}`, import.meta.url).href)
  }
})
