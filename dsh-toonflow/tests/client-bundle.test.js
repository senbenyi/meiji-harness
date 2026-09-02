import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('generated client bundle registers a valid DSH module', async (t) => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { definition = value },
    },
  }
  t.after(() => { globalThis.window = previousWindow })

  await import(`../lib/client.js?test=${Date.now()}`)
  assert.equal(definition.id, '@dsh-external/dsh-toonflow')

  const React = {
    createElement() {},
    useCallback() {},
    useEffect() {},
    useState() {},
  }
  const plugin = definition.factory(id => {
    assert.equal(id, 'react')
    return React
  })
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, [])

  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(bundle, /window\.(?:prompt|confirm)\s*\(/)
  assert.match(bundle, /aria-modal/)
})
