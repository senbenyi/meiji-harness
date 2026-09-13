import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { clientSource } from '../scripts/client-source.mjs'

test('client source directly registers every workbench module', () => {
  const modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } } })
  const require = name => { if (name === 'react') return {}; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  assert.equal(typeof require('elysium/workbench').apply, 'function')
  assert.equal(typeof require('elysium/materials').MaterialList, 'function')
  assert.equal(typeof require('elysium/projects').ProjectList, 'function')
  assert.equal(typeof require('elysium/workbench-styles').apply, 'function')
  assert.equal(typeof require('elysium/dialog').IconButton, 'function')
  assert.equal(modules.has('elysium/conversation-results'), false)
  assert.equal(modules.has('elysium/project-picker'), false)
})

test('client surfaces use opaque Harness background layers', () => {
  const source = clientSource()
  assert.doesNotMatch(source, /--dsw-alias-background-primary/)
  assert.match(source, /\.elysium-panel \{[^}]*background:var\(--dsw-alias-bg-layer-1/)
  assert.match(source, /\.elysium-panel input,\.elysium-panel textarea,\.elysium-panel select \{[^}]*border-radius:8px/)
  assert.match(source, /\.elysium-panel input,\.elysium-panel textarea \{[^}]*background-color:var\(--dsw-alias-bg-layer-1/)
  assert.match(source, /\.elysium-panel select \{ background-color:var\(--dsw-alias-bg-layer-3/)
  assert.match(source, /\.elysium-card \{[^}]*background: var\(--dsw-alias-bg-layer-1/)
})

test('workbench follows the persistent icon sidebar shell and pushes host layout', () => {
  const source = clientSource()
  assert.match(source, /Math\.round\(window\.innerWidth \* 0\.15\)/)
  assert.match(source, /data-elysium-panel-host/)
  assert.match(source, /elysium-panel-hidden/)
  assert.match(source, /--elysium-sidebar-width/)
  assert.match(source, /aria-controls': 'elysium-workbench-panel'/)
  assert.doesNotMatch(source, />创作工作台<\/button>/)
  assert.doesNotMatch(source, /返回聊天/)
})

test('workbench chrome follows the flat Better Sidebar visual hierarchy', () => {
  const source = clientSource()
  assert.match(source, /\.elysium-panel \.elysium-panel-header button \{[^}]*border:0;[^}]*border-right:1px solid var\(--dsw-alias-border-l1/)
  assert.match(source, /background:var\(--dsw-alias-interactive-bg-active/)
  assert.match(source, /\.elysium-material-card \{[^}]*border-radius:12px;[^}]*background:var\(--dsw-alias-bg-layer-3/)
  assert.match(source, /\.elysium-panel select \{[^}]*appearance:none;[^}]*background-image:/)
  assert.match(source, /\.elysium-panel \.elysium-primary \{ background:var\(--dsw-alias-interactive-bg-active/)
  assert.doesNotMatch(source, /\.elysium-panel \.elysium-primary \{ background:var\(--dsw-alias-brand-primary/)
  assert.doesNotMatch(source, /box-shadow:0 16px 64px/)
})

test('workbench actions use compact icons without low-value placeholder copy', () => {
  const source = clientSource()
  assert.match(source, /elysium-icon-button/)
  assert.match(source, /className: 'elysium-shot-status'/)
  assert.doesNotMatch(source, /点击预览视频|未填写描述|未填写动作|规格未提供|未记录描述/)
  assert.doesNotMatch(source, /搜索镜头|镜号、动作或字幕/)
  assert.doesNotMatch(source, /\$\{filtered\.length\} 镜|filter\(\{ act: '', status: '', role: '' \}\)/)
  assert.doesNotMatch(source, /action: '保存并继续'/)
  assert.match(source, /busy, action: '下一步'[^\n]+submit: async draft/)
  assert.match(source, /const directors = \['张艺谋', '王家卫', '陈凯歌', '姜文', '贾樟柯'\]/)
  assert.match(source, /'aria-label': '项目导演'[^\n]+required: true/)
  assert.match(source, /h\('option', \{ value: '' \}, '选导演'\)/)
  assert.doesNotMatch(source, /创建并继续|请选择导演/)
  assert.match(source, /'aria-label': '项目档次'/)
  assert.doesNotMatch(source, /继续制作/)
  assert.doesNotMatch(source, /更多操作 \$\{item\.title\}/)
  assert.match(source, /name: 'minus', label: `删除项目 \$\{item\.title\}`/)
  assert.match(source, /className: 'elysium-project-open', role: 'button'/)
  assert.match(source, /className: 'elysium-project-open'[^\n]+\n\s+h\('h2', null, item\.title\),\n\s+item\.cover_url/)
  assert.match(source, /\.elysium-project-open > img \{[^}]*height:112px;[^}]*object-fit:cover/)
  assert.match(source, /\.elysium-anchor-card \{[^}]*grid-template-columns:64px minmax\(0,1fr\) 30px/)
  assert.match(source, /\.elysium-anchor-thumb \{[^}]*width:64px; height:64px/)
  assert.doesNotMatch(source, /setEditing\(\{ index: -1/)
  assert.doesNotMatch(source, /className: 'elysium-toolbar' \}, h\('h[12]', null/)
  assert.doesNotMatch(source, /h\('label', null, label, h\('select'/)
})
