import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Harness can resolve the UI manifest, server and declared client entries', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  for (const [subpath, target] of [['', 'lib/index.js'], ['/client', 'lib/client.js'], ['/package.json', 'package.json']]) {
    assert.equal(import.meta.resolve(`${pkg.name}${subpath}`), new URL(`../${target}`, import.meta.url).href)
  }
})
