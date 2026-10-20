import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { renderSettingsPanel } from '../src/ui/settings-panel.js'

const spec = {
  language: {
    field: 'output_language', title: '生成语言', default: 'zh-CN',
    options: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English（英文）' }],
  },
  models: {
    session: { title: '会话模型', options: [{ value: 'qwen', label: 'Qwen3.5 27B' }, { value: 'gpt', label: 'GPT（Codex 套餐）' }], default: 'gpt' },
    text: { title: '文本模型', options: [{ value: 'qwen', label: 'Qwen3.5 27B' }, { value: 'gpt', label: 'GPT（Codex 套餐）' }] },
    image: { title: '图片模型', options: [{ value: 'krea', label: 'krea2 turbo V2.5' }, { value: 'gpt-image', label: 'GPT（Codex 套餐）' }], default: 'krea' },
    video: { title: '视频模型', options: [{ value: 'h3', label: 'MiniMax H3' }], default: 'h3' },
  },
}

const mount = (options) => {
  const dom = new JSDOM('<main></main>')
  const host = renderSettingsPanel(spec, { document: dom.window.document, ...options })
  dom.window.document.querySelector('main').append(host)
  return { dom, host, root: host.shadowRoot }
}

test('设置页沿用语言与模型分组，会话模型默认 GPT，没有保存按钮', async () => {
  const { dom, host, root } = mount({ value: { text: { model: 'qwen' } } })
  try {
    await host.ready
    assert.equal(root.querySelector('h2').textContent, '设置')
    assert.equal(root.querySelector('.back').textContent, '← 返回')
    assert.deepEqual([...root.querySelectorAll('h3')].map(node => node.textContent), ['语言', '模型'])
    const session = root.querySelector('[name=session]')
    const text = root.querySelector('[name=text]')
    assert.equal(session.value, 'gpt')
    assert.deepEqual([...session.options].map(option => option.textContent), [...text.options].map(option => option.textContent))
    assert.deepEqual([...root.querySelectorAll('.settings-option')].map(node => node.childNodes[0].textContent), ['生成语言', '会话模型', '文本模型', '图片模型', '视频模型'])
    assert.equal(root.querySelector('button:not(.back)'), null)
  } finally { dom.window.close() }
})

test('选择后写入本地存储，失败时回退并显示原因，运行中冻结', async () => {
  const saved = []
  let fail = false
  const current = { output_language: 'zh-CN', text: { model: 'qwen' }, endpoint: 'local' }
  const store = {
    async read() { return { ...current, session: { model: 'gpt' }, image: { model: 'krea' }, video: { model: 'h3' } } },
    async write(value) {
      if (fail) throw new Error('保存失败')
      saved.push(structuredClone(value))
      return value
    },
  }
  let backed = 0
  const { dom, host, root } = mount({ store, onBack: () => backed++ })
  try {
    await host.ready
    const session = root.querySelector('[name=session]')
    const text = root.querySelector('[name=text]')
    session.value = 'qwen'
    await session.onchange()
    assert.equal(saved.at(-1).session.model, 'qwen')
    assert.equal(saved.at(-1).text.model, 'qwen')
    assert.equal(saved.at(-1).endpoint, 'local')
    fail = true
    text.value = 'gpt'
    await text.onchange()
    assert.equal(text.value, 'qwen')
    assert.match(root.querySelectorAll('.settings-error')[1].textContent, /保存失败/)
    assert.equal(saved.length, 1)
    host.setBusy(true)
    assert.equal(session.disabled, true)
    assert.equal(root.querySelector('[name=output_language]').disabled, true)
    root.querySelector('.back').click()
    assert.equal(backed, 1)
  } finally { dom.window.close() }
})
