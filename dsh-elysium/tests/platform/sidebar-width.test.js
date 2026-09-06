import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePrefs } from '../../src/presentation/workbench/prefs.ts'
import { createSidebarStore, defaultWidthFor } from '../../src/presentation/workbench/state.ts'
import { PrefsSchema } from '../../src/bootstrap/config.ts'

test('sidebar width travels through schema and client validation', () => {
  assert.equal(parsePrefs(PrefsSchema({ defaultWidthPercent: 15 })).defaultWidthPercent, 15)
  for (const value of [0, 101, NaN, '15']) {
    assert.equal(parsePrefs({ defaultWidthPercent: value }).defaultWidthPercent, 35)
  }
  assert.equal(defaultWidthFor(2000, 15), 300)
  assert.equal(defaultWidthFor(1200, 15), 280)
})

test('changed configuration resets saved width once, then preserves dragging across reloads', (t) => {
  const saved = new Map([['dsh-sidebar:v1:width', '800']])
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    innerWidth: 2000, location: { search: '' }, setTimeout: () => 0, clearTimeout: () => {},
  } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  } })
  t.after(() => {
    for (const [key, descriptor] of [['window', oldWindow], ['localStorage', oldStorage]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const prefs = parsePrefs({ defaultWidthPercent: 15 })
  const store = createSidebarStore()
  store.setSession('first')
  assert.equal(store.getSnapshot().state.width, 800)
  store.setPrefs(prefs)
  assert.equal(store.getSnapshot().state.width, 300)
  store.update(state => { state.width = 450 })
  store.setPrefs(prefs)
  assert.equal(store.getSnapshot().state.width, 450)

  const reloaded = createSidebarStore()
  reloaded.setPrefs(prefs)
  reloaded.setSession('second')
  assert.equal(reloaded.getSnapshot().state.width, 450)
  reloaded.setPrefs(parsePrefs({ defaultWidthPercent: 20 }))
  assert.equal(reloaded.getSnapshot().state.width, 400)
  reloaded.setSession('third')
  assert.equal(reloaded.getSnapshot().state.width, 400)
})
