// 职责：验证导演面板的新增、显式编辑、服务端最终值和失败草稿保留。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

test('director panel separates drag from edit and preserves server values and failed drafts', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  let directors = [{ name: '王家卫', style: '都市情绪', works: ['花样年华'] }], failUpdate = false
  runInNewContext(clientSource(), { URLSearchParams, window: { __ELYSIUM_MEDIA__: { token: 't', directorBase: '/director' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true },
    fetch: async (url, options = {}) => {
      const body = options.body && JSON.parse(options.body)
      calls.push({ url, body })
      if (url.startsWith('/director/list')) return { ok: true, json: async () => structuredClone(directors) }
      if (url.startsWith('/director/create')) {
        const value = { ...body, style: body.style.trim(), works: body.works.map(work => work.trim()) }
        directors = [...directors, value]
        return { ok: true, json: async () => structuredClone(value) }
      }
      if (url.startsWith('/director/update')) {
        if (failUpdate) return { ok: false, json: async () => ({ error: '保存失败' }) }
        const value = { ...body, style: body.style.trim(), works: body.works.map(work => work.trim()) }
        directors = directors.map(item => item.name === value.name ? value : item)
        return { ok: true, json: async () => structuredClone(value) }
      }
      throw new Error(`unexpected request: ${url}`)
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/directors').DirectorList)) })
  const article = view.root.findByProps({ className: 'elysium-director-card' })
  assert.equal(article.props.onClick, undefined)
  assert.equal(article.props.title, '拖动排序')
  assert.ok(view.root.findByProps({ 'aria-label': '编辑导演 王家卫' }))

  await act(async () => view.root.findByProps({ 'aria-label': '添加导演' }).props.onClick())
  assert.ok(view.root.findByProps({ 'aria-label': '取消添加导演' }))
  for (const [label, value] of [['导演名称', '毕赣'], ['导演风格', '  梦境叙事  '], ['TOP5作品', '路边野餐\n地球最后的夜晚']]) {
    await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
  }
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.filter(call => call.url.startsWith('/director/create')).length, 1)
  assert.match(JSON.stringify(view.toJSON()), /梦境叙事/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /  梦境叙事  /)

  await act(async () => view.root.findByProps({ 'aria-label': '编辑导演 毕赣' }).props.onClick())
  assert.ok(view.root.findByProps({ 'aria-label': '取消编辑导演' }))
  assert.equal(view.root.findByProps({ 'aria-label': '导演名称' }).props.value, '毕赣')
  await act(async () => view.root.findByProps({ 'aria-label': '导演风格' }).props.onChange({ target: { value: '  长镜头  ' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.filter(call => call.url.startsWith('/director/update')).length, 1)
  assert.match(JSON.stringify(view.toJSON()), /长镜头/)

  failUpdate = true
  await act(async () => view.root.findByProps({ 'aria-label': '编辑导演 毕赣' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '导演风格' }).props.onChange({ target: { value: '未保存草稿' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(view.root.findByProps({ role: 'alert' }).children[0], '保存失败')
  assert.equal(view.root.findByProps({ 'aria-label': '导演风格' }).props.value, '未保存草稿')
  assert.equal(calls.filter(call => call.url.startsWith('/director/update')).length, 2)
  await act(async () => view.unmount())
})
