// 职责：验证导演页签位置、列表范围和各文件独立保存。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

test('director tabs stay above content, only style shows cards, and files save independently', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  const content = name => '---\nname: ' + name + '\ndescription: 导演\nmetadata:\n  kind: director\n  display_name: "导演"\n  order: 0\n---\n\n# 导演\n'
  const names = ['director-one', 'director-two']
  let directors = names.map((name, order) => ({ name, display_name: '导演' + (order + 1), description: '导演', order }))
  const files = new Map(names.map((name, index) => [name, { 'SKILL.md': content(name), 'script.md': '# 剧本' + index,
    'storyboard.md': '# 分镜' + index, 'series.md': '# 总览' }]))
  let failSave = false, allowDiscard = false
  runInNewContext(clientSource(), { URLSearchParams, window: { __ELYSIUM_MEDIA__: { token: 't', directorBase: '/director' },
    __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => allowDiscard },
  fetch: async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body)
    calls.push({ url, body })
    if (url.startsWith('/director/list')) return { ok: true, json: async () => structuredClone(directors) }
    if (url.startsWith('/director/get')) {
      const name = new URL(url, 'http://localhost').searchParams.get('name')
      return { ok: true, json: async () => ({ ...directors.find(item => item.name === name), content: files.get(name)['SKILL.md'], files: files.get(name) }) }
    }
    if (url.startsWith('/director/create')) {
      const item = { name: 'director-three', display_name: body.display_name, description: '导演', order: directors.length }
      directors = [...directors, item]; files.set(item.name, { 'SKILL.md': content(item.name), 'script.md': '# 剧本', 'storyboard.md': '# 分镜', 'series.md': '# 总览' })
      return { ok: true, json: async () => ({ ...item, content: files.get(item.name)['SKILL.md'], files: files.get(item.name) }) }
    }
    if (url.startsWith('/director/save')) {
      if (failSave) return { ok: false, json: async () => ({ error: '保存失败' }) }
      files.get(body.name)[body.file] = body.content
      return { ok: true, json: async () => ({ ...directors.find(item => item.name === body.name), content: files.get(body.name)['SKILL.md'], files: files.get(body.name) }) }
    }
    throw new Error('unexpected request: ' + url)
  } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  const guard = { current: null }
  await act(async () => { view = create(React.createElement(require('elysium/directors').DirectorList, { guard })) })
  const tabs = view.root.findByProps({ 'aria-label': '导演配置页签' })
  assert.deepEqual(tabs.children.map(child => child.children[0]), ['导演风格', '导演总览', '导演剧本', '导演分镜'])
  assert.equal(view.root.findByProps({ className: 'elysium-directors' }).children[0], tabs)
  assert.equal(view.root.findAllByProps({ className: 'elysium-director-card' }).length, 2)
  assert.equal(view.root.findAllByType('textarea').length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '添加导演' }).length, 1)

  await act(async () => tabs.children[2].props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-director-list' }).length, 0)
  assert.equal(view.root.findByProps({ 'aria-label': '选择导演' }).props.value, 'director-one')
  assert.equal(view.root.findByProps({ 'aria-label': '剧本要求' }).props.value, '# 剧本0')
  await act(async () => view.root.findByProps({ 'aria-label': '选择导演' }).props.onChange({ target: { value: 'director-two' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '剧本要求' }).props.onChange({ target: { value: '# 新剧本' } }))
  let left = false
  guard.current(() => { left = true })
  assert.equal(left, false)
  await act(async () => view.root.findByProps({ 'aria-label': '选择导演' }).props.onChange({ target: { value: 'director-one' } }))
  assert.equal(view.root.findByProps({ 'aria-label': '选择导演' }).props.value, 'director-two')
  assert.equal(view.root.findByProps({ 'aria-label': '剧本要求' }).props.value, '# 新剧本')
  await act(async () => view.root.findAllByType('button').find(button => button.children.join('') === '保存').props.onClick())
  assert.equal(files.get('director-two')['script.md'], '# 新剧本')
  assert.equal(files.get('director-one')['script.md'], '# 剧本0')
  assert.equal(guard.current, null)

  await act(async () => tabs.children[3].props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-director-list' }).length, 0)
  for (const [label, file, value] of [['分镜要求', 'storyboard.md', '# 新分镜']]) {
    await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
    await act(async () => view.root.findAllByType('button').find(button => button.children.join('') === '保存' && button.props.disabled === false).props.onClick())
    assert.equal(files.get('director-two')[file], value)
  }

  await act(async () => tabs.children[0].props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-director-card' }).length, 2)
  assert.equal(view.root.findAllByType('textarea').length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '添加导演' }).props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-director-list' }).length, 0)
  const savesBeforeCreate = calls.filter(call => call.url.startsWith('/director/save')).length
  await act(async () => view.root.findByProps({ 'aria-label': '导演名称' }).props.onChange({ target: { value: '新导演' } }))
  assert.equal(view.root.findByType('form').findByProps({ type: 'submit' }).children.join(''), '保存')
  assert.match(view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.value, /display_name: "新导演"/)
  const newSkill = view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.value + '\n独特风格\n'
  await act(async () => view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.onChange({ target: { value: newSkill } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(files.has('director-three'), true)
  assert.equal(view.root.findAllByProps({ className: 'elysium-director-card' }).length, 3)
  assert.equal(view.root.findAllByType('textarea').length, 0)
  assert.equal(calls.filter(call => call.url.startsWith('/director/create')).length, 1)
  assert.equal(calls.find(call => call.url.startsWith('/director/create')).body.content, newSkill)
  assert.equal(calls.filter(call => call.url.startsWith('/director/save')).length, savesBeforeCreate)
  await act(async () => view.root.findByProps({ 'aria-label': '编辑导演 导演2' }).props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-director-list' }).length, 0)
  const draft = content('director-two').replace('# 导演', '# 新风格')
  await act(async () => view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.onChange({ target: { value: draft } }))
  failSave = true
  await act(async () => view.root.findAllByType('button').find(button => button.children.join('') === '保存').props.onClick())
  assert.equal(view.root.findByProps({ role: 'alert' }).children[0], '保存失败')
  assert.equal(view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.value, draft)
  assert.equal(calls.filter(call => call.url.startsWith('/director/save')).at(-1).body.file, 'SKILL.md')
  await act(async () => view.unmount())
})
