import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { apply, Settings, validateSettings } from '../src/index.js'

test('host registers only director settings and validates stored entries', () => {
  const registrations = []
  apply({ settings: { register: (...args) => registrations.push(args) } })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0][0], 'dsh-elysium-ui')
  assert.deepEqual(Settings({}), { enabled: true, directors: [] })
  assert.throws(() => validateSettings({ directors: [{ id: 'a', name: ' ', prompt: 'x' }] }), /不能为空/)
  assert.throws(() => validateSettings({ directors: [1, 2].map(() => ({ id: 'a', name: 'A', prompt: 'B' })) }), /重复/)
})

async function fixture() {
  const bundles = new Map()
  runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => bundles.set(entry.id, entry.factory) } },
    structuredClone, crypto: { randomUUID: () => 'director-test' },
  })
  const client = bundles.get('dsh-external/dsh-elysium-ui')(name => {
    assert.equal(name, 'react')
    return React
  })
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
      inject: (slot, run) => { assert.equal(slot, 'settings.section'); run() },
      register: (options, component) => pages.push({ options, component }),
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

test('manifest has no tools and package does not depend on the old plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url)))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.contributes?.tools, undefined)
  assert.equal(pkg.dependencies['@dsh-external/dsh-elysium'], undefined)
  assert.equal(manifest.id, 'dsh-external/dsh-elysium-ui')
})
