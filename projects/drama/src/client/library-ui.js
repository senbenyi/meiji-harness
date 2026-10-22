import { element } from './panel-dom.js'

function tabs(label, choices, changed) {
  const nav = element('div', '', 'library-tabs')
  nav.setAttribute('role', 'tablist')
  nav.setAttribute('aria-label', label)
  const buttons = choices.map(([value, title]) => {
    const button = element('button', title)
    button.type = 'button'
    button.id = `library-tab-${value}`
    button.setAttribute('role', 'tab')
    button.dataset.value = value
    button.onclick = () => changed(value)
    button.onkeydown = event => {
      const index = buttons.indexOf(button)
      const next = { ArrowRight: (index + 1) % buttons.length, ArrowLeft: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key]
      if (next === undefined) return
      event.preventDefault()
      buttons[next].click()
      buttons[next].focus()
    }
    nav.append(button)
    return button
  })
  return { nav, buttons, select(value) {
    for (const button of buttons) {
      const selected = button.dataset.value === value
      button.setAttribute('aria-selected', String(selected))
      button.tabIndex = selected ? 0 : -1
    }
  } }
}

/** 片库状态由外层持有，重新进入时保留分类；销毁后忽略晚到的读取结果。 */
export function renderLibrary(root, { state, request, openProject, back }) {
  let alive = true, data = null, failure = '', busy = false
  const backButton = element('button', '←', 'back'), heading = element('div', '', 'library-heading')
  backButton.type = 'button'
  backButton.setAttribute('aria-label', '返回上一页')
  backButton.title = '返回上一页'
  backButton.onclick = () => back()
  heading.append(backButton)
  const primary = tabs('片库分类', [['projects', '项目'], ['assets', '素材']], value => { state.tab = value; paint() })
  const secondary = tabs('素材分类', [['characters', '人物'], ['clothing', '衣服'], ['props', '道具'], ['scripts', '剧本']], value => { state.category = value; paint() })
  const projects = element('section', '', 'library-projects'), assets = element('section', '', 'library-assets')
  projects.id = 'library-projects'
  assets.id = 'library-assets'
  for (const [panel, name] of [[projects, 'projects'], [assets, 'assets']]) {
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', `library-tab-${name}`)
  }
  primary.buttons.forEach(button => button.setAttribute('aria-controls', `library-${button.dataset.value}`))
  const rows = element('div', '', 'library-asset-rows'), error = element('p', '', 'error'), upload = element('button', '导入剧本', 'import-script'), file = element('input')
  rows.id = 'library-asset-content'
  rows.setAttribute('role', 'tabpanel')
  secondary.buttons.forEach(button => button.setAttribute('aria-controls', rows.id))
  error.setAttribute('role', 'alert')
  upload.type = 'button'
  file.type = 'file'
  file.accept = '.txt,.text,.md'
  file.hidden = true
  file.setAttribute('aria-label', '导入素材库剧本')
  upload.onclick = () => file.click()
  file.onchange = async () => {
    const selected = file.files?.[0]
    if (!selected || busy) return
    busy = true
    failure = ''
    paint()
    try {
      if (selected.size > 1024 * 1024) throw new Error('剧本不能超过1MB')
      const body = await selected.text()
      if (!alive) return
      const result = await request('library/scripts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' }, body: JSON.stringify({ originalName: selected.name, body }) })
      if (alive) data.assets.unshift(result.asset)
    } catch (cause) { if (alive) failure = cause.message }
    finally { if (alive) { busy = false; file.value = ''; paint() } }
  }
  assets.append(secondary.nav, upload, file, rows)
  root.replaceChildren(heading, primary.nav, projects, assets, error)
  const paint = () => {
    primary.select(state.tab)
    secondary.select(state.category)
    projects.hidden = state.tab !== 'projects'
    assets.hidden = state.tab !== 'assets'
    upload.hidden = state.category !== 'scripts'
    upload.disabled = busy || !data
    upload.textContent = busy ? '正在导入…' : '导入剧本'
    rows.setAttribute('aria-labelledby', `library-tab-${state.category}`)
    error.textContent = failure
    error.hidden = !failure
    projects.replaceChildren()
    rows.replaceChildren()
    if (!data) {
      const loading = failure ? '片库读取失败' : '加载中…'
      projects.append(element('p', loading, 'meta'))
      rows.append(element('p', loading, 'meta'))
      return
    }
    if (!data.projects.length) projects.append(element('p', '暂无项目，点击顶部 + 创建项目', 'meta'))
    for (const project of data.projects) {
      const card = element('article', '', 'library-card'), button = element('button', '打开项目')
      button.type = 'button'
      button.onclick = () => openProject(project.session_id)
      card.append(element('h3', project.name), element('p', project.aspect_ratio, 'meta'), button)
      projects.append(card)
    }
    const matches = data.assets.filter(asset => asset.category === state.category)
    if (!matches.length) rows.append(element('p', `暂无${{ characters: '人物', clothing: '衣服', props: '道具', scripts: '剧本' }[state.category]}素材`, 'meta'))
    for (const asset of matches) {
      const card = element('article', '', 'library-card')
      card.append(element('h3', asset.originalName))
      rows.append(card)
    }
  }
  paint()
  void request('library').then(result => { if (alive) { data = result; paint() } }).catch(cause => { if (alive) { failure = cause.message; paint() } })
  return () => { alive = false }
}
