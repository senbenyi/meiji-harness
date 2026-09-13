import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { clientSource } from '../scripts/client-source.mjs'

test('client source directly registers every workbench module', () => {
  const modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } } })
  const require = name => { if (name === 'react') return {}; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  assert.equal(typeof require('elysium/workbench').apply, 'function')
  assert.equal(typeof require('elysium/materials').MaterialList, 'function')
  assert.equal(typeof require('elysium/projects').ProjectList, 'function')
  assert.equal(typeof require('elysium/workbench-styles').apply, 'function')
})
