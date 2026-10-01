import { renderImageReview, syncImageGate, detailOwnsImage } from './image-review.js'
import { renderCharacterDetail } from './character.js'
import { showPanelDialog, element } from './dom.js'
import { tabOf, tabs } from './flow-view.js'
import { renderShotPage, renderStage, renderSceneDetail } from './stages.js'
import { episodeWork, renderOverview } from './overview.js'
import { bindStylePicker } from './style-picks.js'

const order = tabs.map(tab => tab.id)

export function stageOf(project) {
  return tabOf(project)
}

function createEmpty(openCreate) {
  const view = element('div', '', 'create-empty'), button = element('button', '', 'create-large')
  button.setAttribute('aria-label', '创建项目')
  const plus = element('span', '＋'); plus.setAttribute('aria-hidden', 'true')
  button.append(plus, element('span', '创建项目')); button.onclick = openCreate; view.append(button)
  return view
}

function bindBusy(button, work, pending = '处理中…') {
  button.type = 'button'
  button.onclick = async () => {
    if (!work || button.disabled) return
    button.disabled = true
    const label = button.textContent
    if (pending) button.textContent = pending
    try { await work() } catch (error) {
      button.disabled = false
      if (pending) button.textContent = label
      throw error
    }
  }
  return button
}

function projectMeta(project) {
  const count = Array.isArray(project.episodes) ? project.episodes.length : 0
  return `${count} 集 · ${project.aspectRatio || '1344x768'} · ${project.lifecycle === 'completed' ? '已完成' : '进行中'}`
}


function workspaceButton(context, project) {
  if (!context.onBind) return null
  const label = project?.title || (context.workspace ? `工作区 ${context.workspace.title}` : '未选择工作区')
  const button = element('button', label, 'workspace-bind')
  button.type = 'button'
  button.onclick = context.onBind
  return button
}

function unboundBody(openCreate, context) {
  const body = element('div', '', 'session-body')
  const projects = context.projects || []
  body.append(element('p', '选择一部短剧，进入它的专属工作区', 'notice'))
  for (const item of projects) {
    const card = element('button', '', 'card')
    card.type = 'button'
    card.append(element('strong', item.title), element('span', projectMeta(item), 'meta'))
    card.onclick = () => context.onPick?.(item)
    body.append(card)
  }
  if (!projects.length) body.append(createEmpty(openCreate))
  else {
    const create = element('button', '创建新短剧')
    create.type = 'button'
    create.onclick = openCreate
    body.append(create)
  }
  return body
}

export function catalogDialog(root) {
  const dialog = element('dialog')
  dialog.setAttribute('aria-label', '选择视频项目')
  const title = element('h2', '选择视频项目')
  const close = element('button', '×', 'cancel')
  close.type = 'button'
  close.setAttribute('aria-label', '关闭目录')
  close.onclick = () => dialog.close()
  const head = element('div', '', 'modal-head')
  head.append(title, close)
  const hint = element('p', '', 'notice')
  const list = element('div')
  dialog.append(head, hint, list)
  root.append(dialog)
  return (projects, workspace, onPick) => {
    title.textContent = '选择短剧'
    hint.textContent = '选择后进入该短剧的专属工作区；原工作区和会话保持原样。'
    list.replaceChildren()
    for (const project of projects) {
      const card = element('button', '', 'card')
      card.type = 'button'
      card.append(element('strong', project.title), element('span', projectMeta(project), 'meta'))
      card.onclick = () => { dialog.close(); onPick(project) }
      list.append(card)
    }
    if (!projects.length) list.append(element('p', '还没有视频项目。点加号创建一部。', 'empty'))
    if (!dialog.open) showPanelDialog(dialog)
  }
}

export function renderSession(project, openCreate, actions, context = {}) {
  const view = element('section', '', 'session-view')
  const bind = workspaceButton(context, project)
  if (!project) {
    if (bind) view.append(bind)
    view.append(unboundBody(openCreate, context))
    return view
  }
  const imageGate = syncImageGate(project, context.imageGate)
  const onDetail = detailOwnsImage(context, imageGate)
  if (!onDetail) {
    const previews = renderImageReview(project, actions, context.imageGate)
    if (previews) view.append(previews)
  }
  const detailContext = onDetail ? { ...context, detailGate: imageGate } : context
  if (context.character) {
    const characterProject = episodeWork(project, context.character.episodeId)
    view.append(renderCharacterDetail(characterProject, context.character.itemId, actions, detailContext))
    return view
  }
  if (context.scene) {
    const sceneProject = episodeWork(project, context.scene.episodeId)
    view.append(renderSceneDetail(sceneProject, context.scene.itemId, actions, detailContext))
    return view
  }
  const work = context.episodeId ? episodeWork(project, context.episodeId) : null
  if (!work) {
    const body = element('div', '', 'session-body')
    body.append(renderOverview(project, actions, context))
    view.append(body)
    return view
  }
  const bar = element('div', '', 'episode-bar')
  const back = element('button', '←', 'episode-back')
  back.type = 'button'
  back.setAttribute('aria-label', '返回项目概要')
  back.onclick = () => context.onBack?.()
  const episodes = project.episodes || []
  const index = episodes.findIndex(item => item.id === work.episodeId)
  const number = index < 0 ? episodes.length + 1 : episodes.length - index
  bar.append(back, element('h2', `${project.title} 第 ${number} 集`))
  if (work.activityError && !/^(自检|自审)未通过/.test(work.activityError)) view.append(element('p', work.activityError, 'notice'))
  const shot = (work.shots?.items || []).find(item => item.id === context.shotId)
  if (shot) {
    view.append(renderShotPage(work, shot, actions, context))
    return view
  }
  const overview = element('nav', '', 'stage-overview')
  overview.setAttribute('aria-label', '流程概要')
  overview.addEventListener('wheel', event => {
    if (overview.scrollWidth <= overview.clientWidth) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) return
    overview.scrollLeft += delta
    event.preventDefault()
  }, { passive: false })
  const body = element('div', '', 'session-body')
  const current = stageOf(work)
  let active = tabs.some(tab => tab.id === context.tab) ? context.tab : current
  const paint = () => {
    overview.replaceChildren()
    for (const tab of tabs) {
      const button = element('button', tab.label, 'stage')
      button.type = 'button'
      if (tab.id === active) button.setAttribute('aria-current', 'step')
      if (order.indexOf(tab.id) < order.indexOf(current)) button.classList.add('done')
      if (tab.id === current) button.classList.add('current')
      button.onclick = () => { active = tab.id; context.onSelectTab?.(tab.id); paint() }
      overview.append(button)
    }
    body.replaceChildren(renderStage(active, work, actions, { ...context, onGoTab: id => { active = id; context.onSelectTab?.(id); paint() } }))
  }
  view.append(bar, overview, body)
  paint()
  context.onSelectTab?.(active)
  return view
}

export function projectDialog(root, onCreated) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="create-project" aria-labelledby="create-title"><div class="modal-head"><h2 id="create-title">创建短视频项目</h2><button class="cancel" aria-label="关闭创建弹窗">×</button></div><p>先记下故事摘要。创建后在项目概要里添加剧集，再进入某一集制作。</p><form class="create"><label for="title">短剧标题</label><input id="title" name="title" required maxlength="100" placeholder="给这个故事起个名字" autofocus><label for="aspect">画幅</label><select id="aspect" name="aspect"><option value="1344x768" selected>1344x768</option><option value="768x1344">768x1344</option></select><label for="style">风格</label><input id="style" name="style" required maxlength="120" placeholder="例如：写实电影、国风水墨"><label for="summary">摘要</label><textarea id="summary" name="summary" required maxlength="10000" placeholder="故事摘要，或者开场剧情"></textarea><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">创建项目</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#create-project'), form = dialog.querySelector('form')
  const error = dialog.querySelector('.error')
  const stylePicker = bindStylePicker(form.elements.style)
  for (const button of dialog.querySelectorAll('.cancel')) button.onclick = () => dialog.close()
  form.onsubmit = async event => {
    event.preventDefault()
    const button = form.querySelector('[type=submit]'); button.disabled = true; error.textContent = ''
    try {
      const data = new FormData(form)
      const input = { title: data.get('title').trim(), aspectRatio: data.get('aspect'), style: data.get('style').trim(), summary: data.get('summary').trim() }
      await onCreated(input)
      dialog.close()
    } catch (failure) { error.textContent = failure.message }
    finally { button.disabled = false }
  }
  return () => { form.reset(); form.elements.aspect.value = '1344x768'; stylePicker.sync(); error.textContent = ''; showPanelDialog(dialog) }
}

export function sourceDialog(root, onSaved) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="edit-source" aria-labelledby="edit-source-title"><div class="modal-head"><h2 id="edit-source-title">编辑原始资料</h2><button class="cancel" type="button" aria-label="关闭编辑弹窗">×</button></div><p>修改标题、时长、画幅和剧本摘要。时长、画幅或摘要一变，简报之后的步骤会重新待审。</p><form class="edit"><label for="edit-name">短剧标题</label><input id="edit-name" name="title" required maxlength="100"><label for="edit-duration">时长（秒）</label><input id="edit-duration" name="duration" type="number" min="1" max="86400" step="1" required><label for="edit-aspect">画幅</label><select id="edit-aspect" name="aspect"><option value="1344x768" selected>1344x768</option><option value="768x1344">768x1344</option></select><label for="edit-summary">剧本摘要</label><textarea id="edit-summary" name="summary" required maxlength="10000"></textarea><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#edit-source'), form = dialog.querySelector('form')
  const error = dialog.querySelector('.error')
  let current = null
  for (const button of dialog.querySelectorAll('.cancel')) button.onclick = () => dialog.close()
  form.onsubmit = async event => {
    event.preventDefault()
    const button = form.querySelector('[type=submit]'); button.disabled = true; error.textContent = ''
    try {
      const data = new FormData(form)
      await onSaved(current, {
        title: data.get('title').trim(),
        durationSeconds: Number(data.get('duration')),
        aspectRatio: data.get('aspect'),
        summary: data.get('summary').trim(),
      })
      dialog.close()
    } catch (failure) { error.textContent = failure.message }
    finally { button.disabled = false }
  }
  return project => {
    current = project
    form.elements.title.value = project.title || ''
    form.elements.duration.value = String(project.durationSeconds || '')
    const aspect = { '16:9': '1344x768', '9:16': '768x1344' }[project.aspectRatio] || project.aspectRatio
    form.elements.aspect.value = ['1344x768', '768x1344'].includes(aspect) ? aspect : '1344x768'
    form.elements.summary.value = project.summary.content || ''
    error.textContent = ''
    showPanelDialog(dialog)
  }
}

export function storyDialog(root, onSaved) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="edit-story" aria-labelledby="edit-story-title"><div class="modal-head"><h2 id="edit-story-title">编辑大纲</h2><button class="cancel" type="button" aria-label="关闭编辑弹窗">×</button></div><p>只修改故事大纲。保存后角色之后的步骤会重新待审。</p><form class="edit"><label for="edit-plot">大纲</label><textarea id="edit-plot" name="outline" class="plot"></textarea><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#edit-story'), form = dialog.querySelector('form')
  const error = dialog.querySelector('.error')
  let current = null
  for (const button of dialog.querySelectorAll('.cancel')) button.onclick = () => dialog.close()
  form.onsubmit = async event => {
    event.preventDefault()
    const button = form.querySelector('[type=submit]'); button.disabled = true; error.textContent = ''
    try {
      await onSaved(current, { outline: new FormData(form).get('outline').trim() })
      dialog.close()
    } catch (failure) { error.textContent = failure.message }
    finally { button.disabled = false }
  }
  return project => {
    current = project
    form.elements.outline.value = project.plot.outline.content || ''
    error.textContent = ''
    showPanelDialog(dialog)
  }
}
