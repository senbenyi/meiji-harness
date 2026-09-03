import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('generated client bundle registers a valid DSH module', async (t) => {
  const previousWindow = globalThis.window
  const definitions = []
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { definitions.push(value) },
    },
  }
  t.after(() => { globalThis.window = previousWindow })

  await import(`../lib/client.js?test=${Date.now()}`)
  assert.deepEqual(definitions.map(item => item.id), [
    '@dsh-external/dsh-elysium',
    'dsh-better-sidebar',
  ])
  assert.equal(typeof definitions[0].factory, 'function')

  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(bundle, /window\.(?:prompt|confirm)\s*\(/)
  assert.match(bundle, /aria-modal/)
})
