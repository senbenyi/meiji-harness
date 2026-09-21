// 职责：验证导演面板创建与全文编辑 Skill，失败时保留草稿。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

test('director panel creates and edits SKILL.md while preserving failed drafts', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  const content = name => `---\nname: ${name}\ndescription: 导演\nmetadata:\n  kind: director\n  display_name: "王家卫"\n  order: 0\n---\n\n# 王家卫\n`
  let directors = [{ name: 'director-one', display_name: '王家卫', description: '导演', order: 0 }]
  let skills = new Map([['director-one', content('director-one')]]), failSave = false
  runInNewContext(clientSource(), { URLSearchParams, window: { __ELYSIUM_MEDIA__: { token: 't', directorBase: '/director' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true },
    fetch: async (url, options = {}) => {
      const body = options.body && JSON.parse(options.body)
      calls.push({ url, body })
      if (url.startsWith('/director/list')) return { ok: true, json: async () => structuredClone(directors) }
      if (url.startsWith('/director/get')) {
        const name = new URL(url, 'http://localhost').searchParams.get('name')
        return { ok: true, json: async () => ({ ...directors.find(item => item.name === name), content: skills.get(name) }) }
      }
      if (url.startsWith('/director/create')) {
        const value = { name: 'director-two', display_name: body.display_name, description: '导演', order: 1, content: content('director-two') }
        directors = [...directors, value]; skills.set(value.name, value.content)
        return { ok: true, json: async () => structuredClone(value) }
      }
      if (url.startsWith('/director/save')) {
        if (failSave) return { ok: false, json: async () => ({ error: '保存失败' }) }
        skills.set(body.name, body.content)
        return { ok: true, json: async () => ({ ...directors.find(item => item.name === body.name), content: body.content }) }
      }
      throw new Error(`unexpected request: ${url}`)
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/directors').DirectorList)) })
  assert.equal(view.root.findByProps({ className: 'elysium-director-card' }).props.onClick, undefined)
  assert.equal(view.root.findByProps({ className: 'elysium-director-grip' }).props.title, '拖动排序')
  await act(async () => view.root.findByProps({ 'aria-label': '添加导演' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '导演显示名' }).props.onChange({ target: { value: '毕赣' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.find(call => call.url.startsWith('/director/create')).body.display_name, '毕赣')
  assert.equal(view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.value, content('director-two'))
  const draft = content('director-two').replace('# 王家卫', '# 毕赣长镜头')
  await act(async () => view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.onChange({ target: { value: draft } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.find(call => call.url.startsWith('/director/save')).body.content, draft)
  assert.equal(skills.get('director-two'), draft)
  failSave = true
  await act(async () => view.root.findByProps({ 'aria-label': '编辑导演 毕赣' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.onChange({ target: { value: '未保存草稿' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(view.root.findByProps({ role: 'alert' }).children[0], '保存失败')
  assert.equal(view.root.findByProps({ 'aria-label': 'SKILL.md 全文' }).props.value, '未保存草稿')
  await act(async () => view.unmount())
})
