import { defaultReferenceDuration, referenceDuration, summaryLength, episodeSummaryFailures } from '../shared/episode-summary.js'
import { targetBusy } from './run-activity.js'
import { historyEntry } from './run-history-entry.js'
import { pictureOf } from '../shared/drama-model.js'
import { confirmPanel, showPanelDialog, element } from './panel-dom.js'
import { episodeHints, isAiCreation } from '../shared/script-assembly.js'

export function collectCharacters(project) {
  const characters = []
  const indexByName = new Map()
  for (const episode of project.episodes || []) {
    for (const character of episode.plot.characters?.items || []) {
      const name = String(character.name || '').trim()
      if (!name) continue
      const existing = indexByName.get(name)
      if (existing == null) {
        indexByName.set(name, characters.length)
        characters.push({ ...character, episodeId: episode.id })
        continue
      }
      if (!stillSrc(characters[existing]) && stillSrc(character)) characters[existing] = { ...character, episodeId: episode.id }
    }
  }
  return characters
}

export function episodeWork(project, episodeId) {
  const episode = (project?.episodes || []).find(item => item.id === episodeId)
  if (!episode) return null
  return { ...episode, operationActivity: episode.operationActivity || (project.operationActivity === 'episode' ? 'episode' : null), id: project.id, episodeId: episode.id, title: project.title, aspectRatio: project.aspectRatio, outputLanguage: project.outputLanguage, script: project.script, scriptKind: project.scriptKind, mode: project.mode, premise: project.premise, scriptRevision: project.scriptRevision, library: project.library, projectSummary: project.summary.content, scriptHints: episodeHints(project, episode), pendingScriptProposal: (project.scriptProposals || []).some(item => item.status === 'pending' && item.episodeId === episode.id), skills: project.skills, revision: project.revision }

}

function coverNode(episode) {
  if (episode.cover) {
    const image = element('img', '', 'episode-cover')
    image.src = episode.cover
    image.alt = '剧集封面'
    return image
  }
  return element('div', '封面', 'episode-cover placeholder')
}

function stillSrc(item) {
  return pictureOf(item).localPath || ''
}

function preview(text) {
  const node = element('p', text, 'summary summary-preview')
  return node
}

const editIcon = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.7 2.3 13.7 6.3 5.4 14.6H1.4v-4L9.7 2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'

function deleteButton(project, actions, episode, number) {
  const button = element('button', episode ? '删除本集' : '删除项目', 'delete-content')
  button.type = 'button'
  button.disabled = episode ? targetBusy(project, 'project') : false
  button.setAttribute('aria-label', episode ? `删除第 ${number} 集` : '删除整个项目')
  button.onclick = async event => {
    event.stopPropagation()
    if (button.disabled) return
    const target = episode ? `第 ${number} 集` : `项目《${project.title}》`
    if (!await confirmPanel(`确定删除${target}？将删除剧情数据及本地视频${episode ? '' : '，并清空对应工作区'}，删除后无法恢复。`)) return
    button.disabled = true
    try {
      await actions.perform(project, episode ? 'episode-delete' : 'project-delete', episode ? { episodeId: episode.id, confirmDelete: true } : { confirmDelete: true })
    } catch (error) { button.disabled = false; actions.fail(error) }
  }
  return button
}

export function renderOverview(project, actions, context) {
  const page = element('div', '', 'overview-page')
  page.append(element('p', project.mode === 'free' ? '自由模式' : '剧本模式', 'meta project-mode'))
  const titleRow = element('div', '', 'title-with-edit')
  titleRow.append(element('h2', project.title || '项目概要'))
  if (project.runPauseCount) titleRow.append(element('span', `有暂停任务（${project.runPauseCount}）`, 'run-paused-badge'))
  const edit = element('button', '', 'icon-edit')
  edit.type = 'button'
  edit.setAttribute('aria-label', '编辑标题和画幅')
  edit.innerHTML = editIcon
  edit.disabled = targetBusy(project, 'project')
  edit.onclick = () => actions.openOverview?.(project)
  titleRow.append(edit)
  const titleActions = element('div', '', 'title-actions')
  if (actions.openHistory) titleActions.append(historyEntry(project, actions))
  titleActions.append(deleteButton(project, actions))
  titleRow.append(titleActions)
  page.append(titleRow)
  page.append(element('p', `${project.aspectRatio || '1344x768'} · ${(project.episodes || []).length} 集`, 'meta'))

  if (isAiCreation(project)) {
    const premiseCard = element('article', '', 'overview-card')
    const premiseTitle = element('div', '', 'overview-card-title')
    premiseTitle.append(element('h3', 'AI 创作方向'))
    const premiseEdit = element('button', '', 'icon-edit')
    premiseEdit.type = 'button'; premiseEdit.innerHTML = editIcon; premiseEdit.setAttribute('aria-label', '编辑 AI 创作方向'); premiseEdit.title = '编辑 AI 创作方向'
    premiseEdit.disabled = targetBusy(project, 'project')
    premiseEdit.onclick = () => actions.openPremise?.(project)
    premiseTitle.append(premiseEdit)
    premiseCard.append(premiseTitle, preview(project.premise || '请填写 AI 创作方向后开始制作。')); page.append(premiseCard)
  }

  const summaryCard = element('article', '', 'overview-card')
  summaryCard.append(element('h3', '项目摘要'))
  if (project.summary.content) summaryCard.append(preview(project.summary.content))
  page.append(summaryCard)

  if (project.mode !== 'free') {
    const scriptCard = element('article', '', 'overview-card')
    const scriptName = project.scriptName || (project.scriptKind === 'imported' ? '导入剧本' : '分节剧本')
    const openScript = () => actions.openScript?.(project)
    const scriptTitle = element('div', '', 'script-title-row')
    const scriptFile = element('button', scriptName, 'script-file-name'); scriptFile.type = 'button'; scriptFile.setAttribute('aria-label', `查看剧本：${scriptName}`); scriptFile.onclick = openScript
    const scriptArrow = element('button', '→', 'script-title-arrow'); scriptArrow.type = 'button'; scriptArrow.setAttribute('aria-label', '打开剧本详情'); scriptArrow.title = '打开剧本详情'; scriptArrow.onclick = openScript
    scriptTitle.append(scriptFile, scriptArrow)
    scriptCard.append(element('h3', '剧本'), scriptTitle, element('p', `V${project.scriptRevision || 0} · ${project.scriptSource || '尚未建立'} · ${project.scriptUpdatedAt || ''} · ${(project.scriptProposals || []).filter(item => item.status === 'pending').length} 个待确认方案`, 'meta'))
    page.append(scriptCard)
  }

  const episodes = element('article', '', 'overview-card')
  const head = element('div', '', 'episode-head')
  head.append(element('h3', '剧集'))
  const busy = targetBusy(project, 'project')
  const add = element('button', '＋ 新增剧集', 'episode-add')
  add.type = 'button'
  add.disabled = busy
  add.setAttribute('aria-label', '新增剧集')
  add.onclick = () => { if (!busy) actions.openEpisode?.(project, null) }
  head.append(add)
  episodes.append(head)
  const episodeRail = element('div', '', 'episode-card-list')
  episodes.append(episodeRail)
  const list = [...(project.episodes || [])]
  if (!list.length) {
    const empty = element('div', '', 'episode-placeholder')
    empty.append(element('strong', '还没有剧集'), element('p', '创建第一集后，这里会展示剧集封面、集数和摘要。'))
    const createFirst = element('button', '＋ 新增剧集', 'episode-add')
    createFirst.type = 'button'; createFirst.disabled = busy; createFirst.onclick = () => { if (!busy) actions.openEpisode?.(project, null) }
    empty.append(createFirst); episodeRail.append(empty)
  }
  list.forEach((episode, index) => {
    const card = element('div', '', 'episode-card')
    card.tabIndex = 0
    card.setAttribute('role', 'link')
    const number = list.length - index
    const copy = element('div', '', 'episode-copy')
    const heading = element('div', '', 'workflow-generation-row episode-card-heading')
    heading.append(element('strong', `第 ${number} 集`), element('span', `${episode.durationSeconds || 0} 秒`, 'meta'))
    copy.prepend(heading)
    copy.append(element('p', episode.summary.content || '还没有本集剧情'))
    card.append(coverNode(episode), copy)
    const open = () => context.onOpenEpisode?.(episode.id)
    card.onclick = open
    card.onkeydown = event => {
      if (event.key === 'Enter' && event.target === card) open()
    }
    episodeRail.append(card)
  })

  page.append(episodes)

  const libraries = element('article', '', 'overview-card library-tabs-card')
  const libraryTabs = element('div', '', 'library-tabs')
  const libraryPanels = []
  for (const [index, [kind, title]] of [['characters', '角色库']].entries()) {
    const tab = element('button', title, 'library-tab')
    tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
    const panel = element('div', '', 'library-tab-panel'); panel.setAttribute('role', 'tabpanel'); panel.hidden = index !== 0
    const entries = project.library?.[kind] || []
    if (!entries.length) {
      panel.append(element('p', `暂无${title}数据，将根据剧集自动提取人物角色。`, 'library-empty'))
    } else {
      const strip = element('div', '', `characters-strip library-card-strip library-card-strip-${kind}`)
      for (const entry of entries) {
        const button = element('button', '', `character-item library-card library-card-${kind}`)
        button.setAttribute('aria-label', `${title}详情：${entry.name}`); button.onclick = () => (actions.openLibraryEntry || actions.openLibrary)?.(project, kind, entry.id)
        const variant = entry.variants.find(item => item.id === entry.defaultVariantId) || entry.variants[0]
        const image = variant?.image?.content
        const media = element('span', '', kind === 'scenes' ? 'library-card-image' : 'library-card-avatar')
        if (image?.localPath) { const img = element('img', '', 'character-image'); img.src = image.localPath; img.alt = entry.name; media.append(img) } else media.append(element('span', kind === 'props' ? '道' : (entry.name || title).charAt(0), 'library-card-placeholder'))
        const info = element('span', '', 'library-card-info')
        info.append(element('strong', entry.name || '未命名'))
        const fields = variant?.fields || {}
        const description = kind === 'characters' ? fields.role || fields.identity || '' : kind === 'scenes' ? fields.look || fields.landmark || fields.space || '' : fields.description || fields.category || ''
        if (description) info.append(element('span', description, 'meta'))
        button.append(media, info); strip.append(button)
      }
      panel.append(strip)
    }
    libraryPanels.push(panel); libraryTabs.append(tab)
    tab.onclick = () => libraryPanels.forEach((other, otherIndex) => { other.hidden = otherIndex !== index; libraryTabs.children[otherIndex].setAttribute('aria-selected', otherIndex === index ? 'true' : 'false') })
  }
  libraries.append(libraryTabs, ...libraryPanels)
  page.append(libraries)
  return page
}

export function overviewDialog(root, onSaved) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="edit-overview" aria-labelledby="edit-overview-title"><div class="modal-head"><h2 id="edit-overview-title">编辑项目</h2><button class="cancel" type="button" aria-label="关闭编辑弹窗">×</button></div><form class="edit"><label for="overview-name">短剧标题</label><input id="overview-name" name="title" required maxlength="100"><label for="overview-aspect">画幅</label><select id="overview-aspect" name="aspect"><option value="1344x768" selected>1344x768</option><option value="768x1344">768x1344</option></select><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#edit-overview')
  const form = dialog.querySelector('form')
  const error = dialog.querySelector('.error')
  let current = null
  for (const button of dialog.querySelectorAll('.cancel')) button.onclick = () => dialog.close()
  form.onsubmit = async event => {
    event.preventDefault()
    const button = form.querySelector('[type=submit]')
    button.disabled = true
    error.textContent = ''
    try {
      const data = new FormData(form)
      await onSaved(current, {
        title: data.get('title').trim(),
        aspectRatio: data.get('aspect'),
      })
      dialog.close()
    } catch (failure) { error.textContent = failure.message }
    finally { button.disabled = false }
  }
  return project => {
    current = project
    form.elements.title.value = project.title || ''
    const aspect = { '16:9': '1344x768', '9:16': '768x1344' }[project.aspectRatio] || project.aspectRatio
    form.elements.aspect.value = ['1344x768', '768x1344'].includes(aspect) ? aspect : '1344x768'
    error.textContent = ''
    showPanelDialog(dialog)
  }
}

export function episodeDialog(root, onSaved) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="edit-episode" aria-labelledby="edit-episode-title"><div class="modal-head"><h2 id="edit-episode-title">新增剧集</h2><button class="cancel" type="button" aria-label="关闭剧集弹窗">×</button></div><form class="episode"><label for="episode-duration">本集时长（秒）</label><input id="episode-duration" name="duration" type="number" min="1" max="86400" step="1" required><p>剧本模式从剧本提取本集故事小段，自由模式按 AI 创作方向生成。摘要由故事小段提取，仅用于展示。</p><label for="episode-requirements">本集要求（选填）</label><textarea id="episode-requirements" name="requirements"></textarea><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#edit-episode'), form = dialog.querySelector('form'), error = dialog.querySelector('.error')
  let current, episode
  for (const button of dialog.querySelectorAll('.cancel')) button.onclick = () => dialog.close()
  form.onsubmit = async event => {
    event.preventDefault()
    const save = form.querySelector('[type=submit]'); save.disabled = true; error.textContent = ''
    try {
      const result = await onSaved(current, { episodeId: episode?.id || '', durationSeconds: referenceDuration(Number(form.elements.duration.value)), requirements: form.elements.requirements.value.trim() })
      if (!result?.cancelled) dialog.close()
    } catch (failure) { error.textContent = failure.message }
    finally { save.disabled = false }
  }
  return (project, currentEpisode) => {
    current = project; episode = currentEpisode
    dialog.querySelector('h2').textContent = currentEpisode ? '编辑剧集' : '新增剧集'
    form.elements.duration.value = String(currentEpisode?.durationSeconds ?? defaultReferenceDuration)
    form.elements.requirements.value = currentEpisode?.storyRequirements || ''
    error.textContent = ''; showPanelDialog(dialog)
  }
}

export function premiseDialog(root, onSaved) {
  const dialog = element('dialog'), form = element('form'), text = element('textarea'), error = element('p', '', 'error'), save = element('button', '保存'), cancel = element('button', '取消')
  let current
  text.setAttribute('aria-label', 'AI 创作方向'); text.maxLength = 1000; text.required = true
  cancel.type = 'button'; cancel.onclick = () => dialog.close()
  form.append(element('h2', '编辑 AI 创作方向'), element('p', '用于每一集故事小段的 AI 创作，不限于首集。最多 1000 字；本次要求和已发生剧情优先。'), text, error, cancel, save); dialog.append(form); root.append(dialog)
  form.onsubmit = async event => { event.preventDefault(); if (!text.value.trim()) { error.textContent = 'AI 创作方向必填'; return }; save.disabled = true; try { await onSaved(current, text.value.trim()); dialog.close() } catch (failure) { error.textContent = failure.message } finally { save.disabled = false } }
  return project => { current = project; text.value = project.premise || ''; error.textContent = ''; showPanelDialog(dialog) }
}
