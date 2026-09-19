import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { clientSource, testClientSource } from '../scripts/loader.js'

test('browser bundle registers the exact package name required by Harness', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const registrations = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load(entry) {
    assert.equal(registrations.has(entry.id), false, `Duplicate module: ${entry.id}`)
    registrations.set(entry.id, entry.factory)
  } } } })
  assert.equal(typeof registrations.get(pkg.name), 'function')
  const require = name => { if (name === 'react') return {}; if (!cache.has(name)) cache.set(name, registrations.get(name)(require)); return cache.get(name) }
  for (const [name, member] of [['elysium/workbench', 'apply'], ['elysium/materials', 'MaterialList'], ['elysium/project-list', 'ProjectList'],
    ['elysium/project-detail', 'ProjectDetail'], ['elysium/settings', 'Settings'], ['elysium/directors', 'DirectorList']]) assert.equal(typeof require(name)[member], 'function')
  assert.equal(registrations.has('elysium/conversation-results'), false)
  for (const name of ['elysium/episode-workflow', 'elysium/storyboard', 'elysium/anchors', 'elysium/delivery', 'elysium/project-configuration']) {
    assert.equal(registrations.has(name), false, name)
  }
})

test('legacy workbench modules stay out of the live client and remain loadable in tests', () => {
  const live = new Map(), tests = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load(entry) { live.set(entry.id, entry.factory) } } } })
  runInNewContext(testClientSource(), { window: { __ModuleLoader__: { load(entry) { tests.set(entry.id, entry.factory) } } } })
  for (const name of ['elysium/episode-workflow', 'elysium/storyboard', 'elysium/anchors', 'elysium/delivery', 'elysium/project-configuration']) {
    assert.equal(live.has(name), false, name)
    assert.equal(tests.has(name), true, name)
  }
})

test('Harness can resolve the server and declared client entries', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('config'))
  assert.equal(JSON.parse(readFileSync(new URL('../config/defaults.json', import.meta.url), 'utf8')).version, 1)
  for (const [subpath, target] of [['', 'lib/index.js'], ['/client', 'lib/client.js'], ['/package.json', 'package.json']]) {
    assert.equal(import.meta.resolve(`${pkg.name}${subpath}`), new URL(`../${target}`, import.meta.url).href)
  }
})
