import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { apply, Settings, validateSettings } from '../src/index.js'
import { clientSource } from '../scripts/client-source.mjs'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('host registers only director settings and validates stored entries', () => {
  const registrations = []
  apply({ settings: { register: (...args) => registrations.push(args) }, tools: { register() {} }, on() {} })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0][0], 'dsh-elysium-ui')
  assert.deepEqual(Settings({}), { enabled: true, directors: [] })
  assert.throws(() => validateSettings({ directors: [{ id: 'a', name: ' ', prompt: 'x' }] }), /不能为空/)
  assert.throws(() => validateSettings({ directors: [1, 2].map(() => ({ id: 'a', name: 'A', prompt: 'B' })) }), /重复/)
})

test('director context reads live settings for any Harness preset and preserves other assembly data', async () => {
  let hook
  let reads = 0
  let settings = { enabled: true, directors: [{ id: 'a', name: '叙事导演', prompt: '关注人物动机' }] }
  apply({
    tools: { register() {} },
    settings: { register() {}, get(ns) { assert.equal(ns, 'dsh-elysium-ui'); reads++; return settings } },
    on(event, callback) { assert.equal(event, 'system-prompt/assemble'); hook = callback },
  })
  const base = { sections: [{ name: 'policy', text: '原有规则' }], tools: [{ name: 'existing' }] }
  const context = { agent: { session: { header: { agentPreset: 'elysium' } } } }
  assert.equal(reads, 0)
  assert.equal((await hook(null, { agent: {} }, async () => base)).sections.length, 2)
  assert.equal(reads, 1)
  const first = await hook(null, context, async () => base)
  assert.equal(first.tools, base.tools)
  assert.deepEqual(first.sections[0], base.sections[0])
  assert.equal(base.sections.length, 1)
  const catalog = JSON.parse(first.sections[1].text.split('\n').at(-1))
  assert.equal(catalog[0].id, 'a')
  assert.equal(catalog[0].prompt, undefined)
  assert.equal(first.sections[1].text.includes(settings.directors[0].prompt), false)
  settings = { enabled: true, directors: [{ id: 'b', name: '新导演', prompt: '克制表演' }] }
  const changed = await hook(null, context, async () => first)
  assert.equal(changed.sections.length, 2)
  const updated = JSON.parse(changed.sections[1].text.split('\n').at(-1))
  assert.equal(updated[0].id, 'b')
  assert.notEqual(updated[0].version, catalog[0].version)
  settings.enabled = false
  assert.deepEqual((await hook(null, context, async () => changed)).sections, base.sections)
  settings = { enabled: true, directors: [] }
  assert.deepEqual((await hook(null, context, async () => base)).sections, base.sections)
  settings = undefined
  assert.deepEqual((await hook(null, context, async () => base)).sections, base.sections)
})

test('director loading returns only the requested live version and rejects unavailable entries', async () => {
  const a = { id: 'a', name: '同名', prompt: 'A'.repeat(20000) }
  const b = { id: 'b', name: '同名', prompt: 'B'.repeat(20000) }
  let settings = { enabled: true, directors: [a, b] }
  let hook
  let registered
  const ctx = { settings: { register() {}, get: () => settings },
    tools: { register(tool) { registered = tool } },
    on(_event, callback) { hook = callback } }
  apply(ctx)
  const exec = { agent: { session: { header: { agentPreset: 'elysium' } } } }
  const assembly = { sections: [], tools: [registered, { name: 'existing' }] }
  const indexed = await hook(null, exec, async () => assembly)
  assert.ok(JSON.stringify(indexed.sections).length < 1000)
  assert.equal(JSON.stringify(indexed.sections).includes(a.prompt), false)
  const first = await registered.execute({ id: 'a' }, exec)
  assert.equal(first.prompt, a.prompt)
  assert.equal(JSON.stringify(first).includes(b.prompt), false)
  const catalog = JSON.parse(indexed.sections[0].text.split('\n').at(-1))
  assert.equal(first.version, catalog[0].version)
  a.prompt = '新的风格'
  const latest = await registered.execute({ id: 'a' }, exec)
  assert.notEqual(first.version, latest.version)
  assert.equal(latest.prompt, a.prompt)
  const currentIndex = await hook(null, exec, async () => assembly)
  assert.equal(JSON.parse(currentIndex.sections[0].text.split('\n').at(-1))[0].version, latest.version)
  await assert.rejects(registered.execute({ id: '同名' }, exec), /不存在/)
  settings.directors = [b]
  await assert.rejects(registered.execute({ id: 'a' }, exec), /不存在/)
  settings.enabled = false
  await assert.rejects(registered.execute({ id: 'b' }, exec), /未启用/)
  assert.deepEqual((await hook(null, exec, async () => assembly)).tools, [{ name: 'existing' }])
  await assert.rejects(registered.execute({ id: 'b' }, { agent: {} }), /未启用/)
  settings.enabled = true
  assert.equal((await registered.execute({ id: 'b' }, { agent: { session: { header: { agentPreset: 'standard' } } } })).prompt, b.prompt)
  settings.enabled = false
  assert.deepEqual((await hook(null, { agent: {} }, async () => assembly)).tools, [{ name: 'existing' }])
  assert.equal(assembly.tools.length, 2)
})

async function fixture() {
  const bundles = new Map()
  runInNewContext(clientSource(), {
    window: { __ModuleLoader__: { load: entry => bundles.set(entry.id, entry.factory) } },
    structuredClone, crypto: { randomUUID: () => 'director-test' },
  })
  const load = name => name === 'react' ? React : bundles.get(name)(load)
  const client = load(pkg.name)
  let snapshot = { status: 'ready', writable: true, revision: 1,
    value: { enabled: true, directors: [] } }
  const listeners = new Set()
  const writes = []
  const publish = patch => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    async mutate(ops, expectedRevision) {
      if (expectedRevision !== snapshot.revision) throw new Error('SETTINGS_CONFLICT')
      const value = { ...snapshot.value, [ops[0].path[0]]: structuredClone(ops[0].value) }
      validateSettings(value)
      writes.push(ops)
      publish({ value, revision: snapshot.revision + 1 })
    },
    async set(field, value) { return this.mutate([{ op: 'set', path: [field], value }], snapshot.revision) },
  }
  const pages = []
  client.apply({
    settingsScope: { bind: spec => { assert.equal(spec.namespace, 'dsh-elysium-ui'); return scope } },
    slots: {
      inject: (_slot, run) => run(),
      register: (options, component) => { if (options.name === 'settings.section') pages.push({ options, component }) },
    },
  })
  assert.equal(pages.length, 1)
  assert.equal(pages[0].options.label(), '极乐世界')
  let view
  await act(async () => { view = create(React.createElement(pages[0].component, pages[0].options.inject())) })
  const click = async label => act(async () => {
    view.root.findAllByType('button').find(button => button.children.join('') === label).props.onClick()
  })
  const submit = () => act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  const fill = () => act(async () => {
    view.root.findAllByType('input').find(input => input.props.type !== 'checkbox').props.onChange({ target: { value: '叙事导演' } })
    view.root.findByType('textarea').props.onChange({ target: { value: '关注人物动机与镜头衔接。' } })
  })
  return { view, scope, writes, publish, click, submit, fill }
}

test('directors are created and deleted only on save; toggle preserves saved data', async () => {
  const f = await fixture()
  try {
    await f.click('新增导演')
    await f.fill()
    assert.equal(f.writes.length, 0)
    await f.submit()
    assert.equal(f.scope.getSnapshot().value.directors[0].name, '叙事导演')
    await act(async () => f.view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: false } }))
    assert.equal(f.view.root.findAllByType('form').length, 0)
    assert.equal(f.scope.getSnapshot().value.directors.length, 1)
    await act(async () => f.scope.set('enabled', true))
    await f.click('删除')
    assert.equal(f.scope.getSnapshot().value.directors.length, 1)
    await f.submit()
    assert.equal(f.scope.getSnapshot().value.directors.length, 0)
  } finally { await act(async () => f.view.unmount()) }
})

test('stale edits are refused and can be reloaded without overwriting remote state', async () => {
  const f = await fixture()
  try {
    await f.click('新增导演'); await f.fill()
    await act(async () => f.publish({ revision: 2 }))
    await f.submit()
    assert.equal(f.writes.length, 0)
    assert.match(f.view.root.findByProps({ role: 'status' }).children.join(''), /保存失败/)
    await f.click('重新加载')
    assert.equal(f.view.root.findAllByType('textarea').length, 0)
  } finally { await act(async () => f.view.unmount()) }
})

test('read-only and unavailable settings never expose writable controls', async () => {
  const f = await fixture()
  try {
    await act(async () => f.publish({ writable: false }))
    assert.equal(f.view.root.findByProps({ type: 'checkbox' }).props.disabled, true)
    assert.equal(f.view.root.findAllByType('fieldset')[0].props.disabled, true)
    await f.submit()
    assert.equal(f.writes.length, 0)
    await act(async () => f.publish({ status: 'unavailable' }))
    assert.equal(f.view.root.findAllByType('form').length, 0)
  } finally { await act(async () => f.view.unmount()) }
})

test('manifest declares only the director reader and package does not depend on the old plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url)))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.deepEqual(manifest.contributes?.tools, ['elysium_read_director'])
  assert.equal(pkg.dependencies['@dsh-external/dsh-elysium'], undefined)
  assert.equal(manifest.id, 'dsh-external/dsh-elysium-ui')
})
