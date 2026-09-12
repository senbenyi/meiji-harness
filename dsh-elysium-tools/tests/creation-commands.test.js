import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { clientSource } from '../build-scripts/client-source.mjs'
import { creationInstructions } from '../src/creation-instructions.js'

function load() {
  const factories = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: definition => factories.set(definition.id, definition.factory) } } })
  return factories.get('elysium-tools/creation-commands')()
}
const names = ['预览创作', '常规创作', '高清创作']

test('Chinese creation commands have fixed display order, no skill indirection, and filter without reordering', async () => {
  const { source } = load()
  const rows = await source.candidates({}, { position: 'leading', query: '' })
  assert.deepEqual(Array.from(rows, row => row.name), names)
  assert.ok(source.order < 0)
  assert.equal((await source.candidates({}, { position: 'inline', query: '' })).length, 0)
  assert.deepEqual(Array.from(await source.candidates({}, { position: 'leading', query: '创作' }), row => row.name), names)
  assert.equal((await source.candidates({}, { position: 'leading', query: '高清' }))[0].name, '高清创作')
})

test('menu selection only claims input; blank input, attachments and transport failure cannot report success', async () => {
  const { source } = load()
  const sent = []
  const actx = { get: () => ({ send: async text => sent.push(text) }) }
  for (const name of names) {
    const { claim } = source.onPick({ position: 'leading', candidate: { name } })
    assert.equal(claim.token, `/${name} `)
    assert.equal(sent.length, names.indexOf(name))
    assert.equal((await claim.submit(' ', actx)).kind, 'error')
    assert.equal((await claim.submit('test', actx, [{}])).kind, 'error')
    await assert.rejects(claim.submit('test', { get: () => ({ send: async () => { throw new Error('offline') } }) }), /offline/)
    assert.equal((await claim.submit('只验证档位，不生成', actx)).kind, 'success')
    assert.equal(sent.at(-1), `【${name}】\n只验证档位，不生成`)
    assert.ok(source.matchSpace({}, `/${name}`).claim)
    assert.ok((await source.matchEnter({}, `/${name} 内容`)).claim)
  }
  assert.equal(source.matchSpace({}, '/预览创作-extra'), undefined)
  assert.equal(await source.matchEnter({}, '/普通消息'), undefined)
  for (const [name, profile] of names.map((name, i) => [name, ['preview', 'regular', 'high-quality'][i]])) {
    assert.match(creationInstructions, new RegExp(`【${name}】[^；]*profile=${profile}`))
  }
  assert.match(creationInstructions, /验证不生成/)
})
