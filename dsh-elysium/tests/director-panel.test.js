// 职责：验证导演面板按步骤页签全文编辑、切换导演、新建与保存失败保留文本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

test('director panel edits each step file in full text and keeps text when saving fails', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  const content = name => '---\nname: ' + name + '\ndescription: 导演\nmetadata:\n  kind: director\n  display_name: "导演"\n  order: 0\n---\n\n# 导演\n'
  const names = ['director-one', 'director-two']
  let directors = names.map((name, order) => ({ name, display_name: '导演' + (order + 1), description: '导演', order }))
  const files = new Map(names.map((name, index) => [name, { 'SKILL.md': content(name), 'project.md': '# 立项' + index, 'series.md': '# 总览' + index,
    'script.md': '# 剧本' + index, 'storyboard.md': '# 分镜' + index }]))
  let failSave = false
  runInNewContext(clientSource(), { URLSearchParams, window: { __ELYSIUM_MEDIA__: { token: 't', directorBase: '/director' },
    __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true },
  fetch: async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body)
    calls.push({ url, body })
    const reply = name => ({ ok: true, json: async () => ({ ...directors.find(item => item.name === name), files: files.get(name) }) })
    if (url.startsWith('/director/list')) return { ok: true, json: async () => structuredClone(directors) }
    if (url.startsWith('/director/get')) return reply(new URL(url, 'http://localhost').searchParams.get('name'))
    if (url.startsWith('/director/create')) {
      const item = { name: 'director-three', display_name: body.display_name, description: '导演', order: directors.length }
      directors = [...directors, item]; files.set(item.name, { 'SKILL.md': content(item.name), 'project.md': '', 'series.md': '', 'script.md': '', 'storyboard.md': '' })
      return reply(item.name)
    }
    if (url.startsWith('/director/save')) {
      if (failSave) return { ok: false, json: async () => ({ error: '保存失败' }) }
      files.get(body.name)[body.file] = body.content
      return reply(body.name)
    }
    throw new Error('unexpected request: ' + url)
  } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/directors').DirectorList)) })
  const tabs = () => view.root.findByProps({ 'aria-label': '导演配置页签' }).findAllByType('button')
  const editor = () => view.root.findAllByType('textarea')[0]
  assert.deepEqual(tabs().map(tab => tab.children.join('')), ['总纲', '立项', '总览', '剧本', '分镜'])
  assert.equal(view.root.findByProps({ 'aria-label': '选择导演' }).props.value, 'director-one')
  assert.equal(editor().props.value, content('director-one'))

  await act(async () => tabs()[3].props.onClick())
  assert.equal(editor().props.value, '# 剧本0')
  await act(async () => view.root.findByProps({ 'aria-label': '选择导演' }).props.onChange({ target: { value: 'director-two' } }))
  assert.equal(editor().props.value, '# 剧本1')
  await act(async () => editor().props.onChange({ target: { value: '# 新剧本' } }))
  await act(async () => editor().props.onBlur())
  assert.equal(files.get('director-two')['script.md'], '# 新剧本')
  assert.equal(files.get('director-one')['script.md'], '# 剧本0')

  await act(async () => tabs()[1].props.onClick())
  failSave = true
  await act(async () => editor().props.onChange({ target: { value: '# 立项草稿' } }))
  await act(async () => editor().props.onBlur())
  assert.equal(view.root.findByProps({ role: 'alert' }).children[0], '保存失败')
  assert.equal(editor().props.value, '# 立项草稿')
  failSave = false

  await act(async () => view.root.findByProps({ 'aria-label': '添加导演' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '导演名称' }).props.onChange({ target: { value: '新导演' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.find(call => call.url.startsWith('/director/create')).body.display_name, '新导演')
  assert.equal(view.root.findByProps({ 'aria-label': '选择导演' }).props.value, 'director-three')
  assert.equal(tabs().find(tab => tab.props['aria-selected']).children.join(''), '总纲')
  await act(async () => view.unmount())
})
