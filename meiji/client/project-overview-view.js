import { defaultReferenceDuration, referenceDuration, summaryLength, episodeSummaryFailures } from '../shared/episode-summary.js'
import { renderSteps, taskStatusLabels } from './task-nodes.js'
import { renderTaskHistory, historyEntry } from './execution-history.js'
import { pictureOf } from '../shared/drama-model.js'
import { confirmPanel, showPanelDialog, element, appendJsonCopy } from './panel-dom.js'
import { scriptFreshness, episodeHints, isAiCreation } from '../shared/script-assembly.js'
import { bindStylePicker } from './style-picks.js'

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
  return { ...episode, operationActivity: episode.operationActivity || (project.operationActivity === 'episode' ? 'episode' : null), id: project.id, episodeId: episode.id, title: project.title, aspectRatio: project.aspectRatio, style: project.style, outputLanguage: project.outputLanguage, script: project.script, scriptKind: project.scriptKind, mode: project.mode, premise: project.premise, scriptRevision: project.scriptRevision, library: project.library, projectSummary: project.summary.content, scriptHints: episodeHints(project, episode), pendingScriptProposal: (project.scriptProposals || []).some(item => item.status === 'pending' && item.episodeId === episode.id), skills: project.skills, revision: project.revision }

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
  button.disabled = Boolean(project.projectBusy)
  button.setAttribute('aria-label', episode ? `删除第 ${number} 集` : '删除整个项目')
  button.onclick = async event => {
    event.stopPropagation()
    if (button.disabled) return
    const target = episode ? `第 ${number} 集` : `项目《${project.title}》`
    if (!await confirmPanel(`确定删除${target}？将删除剧情数据及本地视频${episode ? '' : '，并删除对应工作区（保留会话记录）'}，此操作无法撤销。`)) return
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
  const edit = element('button', '', 'icon-edit')
  edit.type = 'button'
  edit.setAttribute('aria-label', '编辑标题、画幅和风格')
  edit.innerHTML = editIcon
  edit.disabled = Boolean(project.projectBusy)
  edit.onclick = () => actions.openOverview?.(project)
  titleRow.append(edit)
  page.append(titleRow)
  const style = typeof project.style === 'string' && project.style.trim() ? `${project.style.trim()} · ` : ''
  page.append(element('p', `${project.aspectRatio || '1344x768'} · ${style}${(project.episodes || []).length} 集`, 'meta'))

  const projectActions = element('div', '', 'project-actions')
  if (actions.openHistory) projectActions.append(historyEntry(project, actions))
  projectActions.append(deleteButton(project, actions))
  page.append(projectActions)

  if (isAiCreation(project)) {
    const premiseCard = element('article', '', 'overview-card')
    premiseCard.append(element('h3', 'AI 创作方向'), preview(project.premise || '请填写 AI 创作方向后开始制作。'), element('p', '由你手动编辑，持续指导每一集摘要的 AI 创作；修改后用于后续生成，保留已发生剧情。', 'meta'))
    const premiseEdit = element('button', '编辑创作方向')
    premiseEdit.disabled = Boolean(project.projectBusy)
    premiseEdit.onclick = () => actions.openPremise?.(project)
    premiseCard.append(premiseEdit); page.append(premiseCard)
  }

  const summaryCard = element('article', '', 'overview-card')
  summaryCard.append(element('h3', '项目摘要'))
  if (project.script) {
    const row = element('div', '', 'workflow-generation-row')
    const busy = Boolean(project.projectBusy)
    row.append(element('span', project.summary.operation ? '提取中' : project.summary.error ? '提取失败' : project.summary.check.passed === false ? '自审未通过' : scriptFreshness(project).summaryNeedsUpdate ? '待更新' : project.summary.check.passed === true ? '最新' : '待更新', 'meta'))
    const generate = element('button', project.summary.error ? '重试更新摘要' : '立即更新摘要')
    generate.type = 'button'; generate.disabled = busy
    generate.onclick = async () => {
      generate.disabled = true
      try { await actions.perform(project, 'project-summary') }
      catch (error) { generate.disabled = false; actions.fail(error) }
    }
    const opinion = element('input'), revise = element('button', '按意见重新生成')
    opinion.setAttribute('aria-label', '项目摘要修改意见'); opinion.placeholder = '修改意见'
    revise.disabled = busy
    revise.onclick = async () => { if (!opinion.value.trim()) return; try { await actions.perform(project, 'project-summary', { review: opinion.value.trim() }) } catch (error) { actions.fail(error) } }
    row.append(generate, opinion, revise)
    if (actions.openHistory) { const history = element('button', '查看摘要任务历史 →'); history.type = 'button'; history.onclick = () => actions.openHistory(project, 'project-summary'); row.append(history) }
    if (actions.openSkill) { const skill = element('button', '查看 skill'); skill.type = 'button'; skill.onclick = () => actions.openSkill(project, 'project-summary'); row.append(skill) }
    summaryCard.append(row)
    const failure = project.summary.error || (project.summary.check.failures || []).join('；')
    if (failure) summaryCard.append(element('p', failure, 'error'))
  }
  if (project.summary.content) summaryCard.append(preview(project.summary.content))
  page.append(summaryCard)

  const scriptCard = element('article', '', 'overview-card')
  scriptCard.append(element('h3', '剧本'), element('p', `${project.scriptKind === 'imported' ? '导入剧本' : '分节剧本'} · V${project.scriptRevision || 0} · ${project.scriptSource || '尚未建立'} · ${project.scriptUpdatedAt || ''} · ${(project.scriptProposals || []).filter(item => item.status === 'pending').length} 个待确认方案`, 'meta'))
  scriptCard.append(preview(project.script || '等待第一集建立剧本。'))
  const openScript = element('button', '查看与编辑剧本'), direction = element('button', '修改后续剧情')
  openScript.onclick = direction.onclick = () => actions.openScript?.(project)
  scriptCard.append(openScript, direction)
  page.append(scriptCard)

  for (const [kind, title] of [['characters', '角色库'], ['scenes', '场景库'], ['props', '道具库']]) {
    const card = element('article', '', 'overview-card'), open = element('button', `查看与管理${title}`)
    card.append(element('h3', title)); open.onclick = () => actions.openLibrary?.(project, kind); card.append(open)
    const strip = element('div', '', 'characters-strip')
    for (const entry of project.library?.[kind] || []) {
      const button = element('button', entry.name, 'character-item'); button.setAttribute('aria-label', `${title}详情：${entry.name}`); button.onclick = () => actions.openLibrary?.(project, kind)
      const image = entry.variants.find(variant => variant.id === entry.defaultVariantId)?.image.content
      if (image?.localPath) { const img = element('img', '', 'character-image'); img.src = image.localPath; img.alt = entry.name; button.prepend(img) }
      strip.append(button)
    }
    card.append(strip); page.append(card)
  }

  const episodes = element('article', '', 'overview-card')
  const head = element('div', '', 'episode-head')
  head.append(element('h3', '剧集'))
  const busy = Boolean(project.projectBusy)
  const add = element('button', '＋ 新增剧集', 'episode-add')
  add.type = 'button'
  add.disabled = busy
  add.setAttribute('aria-label', '新增剧集')
  add.onclick = () => { if (!busy) actions.openEpisode?.(project, null) }
  head.append(add)
  episodes.append(head)
  const list = [...(project.episodes || [])]
  list.forEach((episode, index) => {
    const card = element('div', '', 'episode-card')
    card.tabIndex = 0
    card.setAttribute('role', 'link')
    const number = list.length - index
    const copy = element('div', '', 'episode-copy')
    copy.append(element('strong', `第 ${number} 集`))
    copy.append(element('span', `${episode.durationSeconds || 0} 秒`, 'meta'))
    copy.append(element('p', episode.summary.content || '还没有本集剧情'))
    const hints = episodeHints(project, episode)
    copy.append(element('span', [hints.scriptUpdated && '剧本已更新', hints.previousModified && '前集已修改', hints.pendingSync && '待回写'].filter(Boolean).join(' · '), 'meta'))
    const edit = element('button', '编辑', 'episode-edit')
    edit.type = 'button'
    edit.disabled = busy
    edit.onclick = event => {
      event.stopPropagation()
      actions.openEpisode?.(project, episode)
    }
    const regenerate = element('button', busy ? '生成中' : '重新生成摘要', 'episode-regenerate')
    regenerate.type = 'button'
    regenerate.disabled = Boolean(project.projectBusy)
    regenerate.setAttribute('aria-label', `重新生成第 ${number} 集摘要`)
    regenerate.title = '重新生成摘要，保留时长；摘要变化后本集下游内容需重新生成'
    regenerate.onclick = event => {
      event.stopPropagation()
      if (regenerate.disabled) return
      regenerate.disabled = true
      regenerate.textContent = '生成中'
      actions.perform(project, 'episode-generate', { episodeId: episode.id, generationMode: 'regenerate' }).catch(error => {
        regenerate.disabled = false
        regenerate.textContent = '重新生成摘要'
        actions.fail(error)
      })
    }
    const heading = element('div', '', 'workflow-generation-row episode-card-heading')
    heading.append(copy.querySelector('strong'))
    copy.prepend(heading)
    appendJsonCopy(heading, episode)
    const cardActions = element('div', '', 'episode-card-actions')
    cardActions.append(edit, regenerate, deleteButton(project, actions, episode, number))
    card.append(coverNode(episode), copy, cardActions)
    const open = () => context.onOpenEpisode?.(episode.id)
    card.onclick = open
    card.onkeydown = event => {
      if (event.key === 'Enter' && event.target === card) open()
    }
    episodes.append(card)
  })

  page.append(episodes)
  return page
}

export function overviewDialog(root, onSaved) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="edit-overview" aria-labelledby="edit-overview-title"><div class="modal-head"><h2 id="edit-overview-title">编辑项目</h2><button class="cancel" type="button" aria-label="关闭编辑弹窗">×</button></div><form class="edit"><label for="overview-name">短剧标题</label><input id="overview-name" name="title" required maxlength="100"><label for="overview-aspect">画幅</label><select id="overview-aspect" name="aspect"><option value="1344x768" selected>1344x768</option><option value="768x1344">768x1344</option></select><label for="overview-style">风格</label><input id="overview-style" name="style" maxlength="120" placeholder="例如：写实电影、国风水墨"><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#edit-overview')
  const form = dialog.querySelector('form')
  const error = dialog.querySelector('.error')
  const stylePicker = bindStylePicker(form.elements.style)
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
        style: data.get('style').trim(),
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
    form.elements.style.value = project.style || ''
    stylePicker.sync()
    error.textContent = ''
    showPanelDialog(dialog)
  }
}

export function episodeDialog(root, onSaved, onGenerate, { openHistory, loadPrompts, loadResponses, observeSync, openScript, regenerate } = {}) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="edit-episode" aria-labelledby="edit-episode-title"><div class="modal-head"><h2 id="edit-episode-title">新增剧集</h2><button class="cancel" type="button" aria-label="关闭剧集弹窗">×</button></div><form class="episode"><label for="episode-duration">本集时长（秒）</label><input id="episode-duration" name="duration" type="number" min="1" max="86400" step="1" required><p>本集时长由你设定，AI 按此时长设计剧情容量，不会修改时长。</p><label for="episode-requirements">本次要求</label><textarea id="episode-requirements" name="requirements"></textarea><label for="episode-summary">本集剧情摘要</label><button class="ai-summary" type="button">AI 生成</button><button class="stop-summary" type="button" hidden>停止生成</button><textarea id="episode-summary" name="summary" required placeholder="填写摘要，或点击 AI 生成"></textarea><output class="summary-count" aria-live="polite"></output><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#edit-episode')
  const form = dialog.querySelector('form')
  const error = dialog.querySelector('.error')
  const generate = dialog.querySelector('.ai-summary'), stop = dialog.querySelector('.stop-summary'), save = form.querySelector('[type=submit]')
  const count = dialog.querySelector('.summary-count')
  const progress = element('div', '', 'episode-task-progress')
  const history = element('button', '查看摘要任务历史 →', 'task-history-entry')
  history.type = 'button'
  history.onclick = () => { dialog.close(); openHistory?.({ ...current, episodeId: episode?.id || '' }) }
  form.querySelector('footer').before(progress, history)
  let current, episode, controller, version = 0
  const updateCount = () => {
    const length = summaryLength(form.elements.summary.value)
    count.textContent = `${length} 字（不计空白，标点计入）`
  }
  const busy = value => { generate.disabled = value; save.disabled = value; stop.hidden = !value }
  const cancel = () => { version++; controller?.abort(); controller = null; busy(false) }
  for (const button of dialog.querySelectorAll('.cancel')) button.onclick = () => { cancel(); dialog.close() }
  dialog.addEventListener('cancel', cancel)
  dialog.addEventListener('close', cancel)
  stop.onclick = cancel
  form.addEventListener('input', event => {
    if (![form.elements.duration, form.elements.summary, form.elements.requirements].includes(event.target)) return
    cancel()
    updateCount()
  })
  generate.onclick = async () => {
    error.textContent = ''
    try {
      const reference = referenceDuration(Number(form.elements.duration.value))
      cancel()
      const requestVersion = version, abort = controller = new AbortController()
      busy(true)
      try {
        const draft = await onGenerate(current, { episodeId: episode?.id || '', referenceDurationSeconds: reference, requirements: form.elements.requirements.value.trim() }, { signal: abort.signal, onTask: task => {
          if (version !== requestVersion || !dialog.open) return
          progress.replaceChildren(element('p', `生成剧集摘要：${taskStatusLabels[task.status] || task.status}`, 'meta'))
          for (const unit of task.tasks || [task]) {
            const section = element('section', '', 'episode-summary-task')
            section.append(element('h4', `${unit.label || (unit.type === 'project-summary' ? '项目摘要' : '剧集摘要')}：${taskStatusLabels[unit.status] || unit.status}`), renderSteps(unit.nodes, { live: ['queued', 'running'].includes(unit.status), loadPrompts: loadPrompts && (node => loadPrompts(current, unit, node)), loadResponses: loadResponses && (node => loadResponses(current, unit, node)) }))
            progress.append(section)
          }
        } })
        if (abort.signal.aborted || version !== requestVersion || !dialog.open) return
        const failures = episodeSummaryFailures(draft)
        if (failures.length) throw new Error(failures.join('；'))
        form.elements.summary.value = draft.summary
        updateCount()
      } catch (failure) { if (!abort.signal.aborted && version === requestVersion) error.textContent = failure.message + (failure.draft ? `\n未通过的候选摘要：${failure.draft.summary}` : '') }
      finally { if (version === requestVersion) { controller = null; busy(false) } }
    } catch (failure) { error.textContent = failure.message }
  }
  form.onsubmit = async event => {
    event.preventDefault()
    if (controller) return
    save.disabled = true
    error.textContent = ''
    try {
      const summary = form.elements.summary.value.trim()
      if (!summaryLength(summary)) throw new Error('摘要不能为空')
      const durationSeconds = referenceDuration(Number(form.elements.duration.value))
      const result = await onSaved(current, { episodeId: episode?.id || '', durationSeconds, summary, requirements: form.elements.requirements.value.trim() })
      if (result?.cancelled) return
      const episodeId = result?.result?.episodeId || episode?.id || result?.project?.episodes?.[0]?.id
      if (result?.result?.scriptSyncOperationId && observeSync) {
        progress.replaceChildren(element('p', '摘要已保存，正在独立回写剧本。', 'meta'))
        const state = await observeSync(current, result.result.scriptSyncOperationId, task => {
          if (dialog.open) progress.replaceChildren(element('p', `剧本回写：${taskStatusLabels[task.status] || task.status}`, 'meta'))
        })
        if (!dialog.open) return
        if (state.status === 'completed' && !state.result?.pendingProposal) { dialog.close(); return }
        progress.replaceChildren(element('p', state.result?.pendingProposal ? '回写方案待确认。摘要已保存，尚未完成同步。' : `待回写：${state.error || state.failures?.join('；') || '回写未完成'}`, 'notice'))
      } else if (!result?.result?.scriptSyncError) { dialog.close(); return }
      else progress.replaceChildren(element('p', `摘要已保存，待回写：${result.result.scriptSyncError}`, 'notice'))
      const process = element('button', '按方案修改剧本'), revert = element('button', '把本集改回符合剧本'), keep = element('button', '先保留'), retry = element('button', '重新回写')
      for (const button of [process, revert, keep, retry]) button.type = 'button'
      process.onclick = () => { dialog.close(); openScript?.(current) }
      revert.onclick = () => { dialog.close(); regenerate?.(current, { episodeId, requirements: '将本集改回符合当前剧本' }).catch(failure => { error.textContent = failure.message }) }
      keep.onclick = () => dialog.close()
      retry.onclick = () => { dialog.close(); openScript?.(current) }
      progress.append(process, revert, keep, retry)
    } catch (failure) { error.textContent = failure.message }
    finally { save.disabled = false }
  }
  return (project, currentEpisode) => {
    cancel()
    current = project
    episode = currentEpisode
    progress.replaceChildren()
    history.open = false
    history.querySelector('section')?.remove()
    dialog.querySelector('h2').textContent = currentEpisode ? '编辑剧集' : '新增剧集'
    form.elements.duration.value = String(currentEpisode?.durationSeconds ?? defaultReferenceDuration)
    form.elements.summary.value = currentEpisode?.summary?.content || ''
    form.elements.requirements.required = false
    form.elements.requirements.value = ''
    dialog.querySelector('label[for=episode-requirements]').textContent = '本次要求（选填）'
    updateCount()
    error.textContent = ''
    showPanelDialog(dialog)
  }
}

export function premiseDialog(root, onSaved) {
  const dialog = element('dialog'), form = element('form'), text = element('textarea'), error = element('p', '', 'error'), save = element('button', '保存'), cancel = element('button', '取消')
  let current
  text.setAttribute('aria-label', 'AI 创作方向'); text.maxLength = 1000; text.required = true
  cancel.type = 'button'; cancel.onclick = () => dialog.close()
  form.append(element('h2', '编辑 AI 创作方向'), element('p', '用于每一集摘要的 AI 创作，不限于首集。最多 1000 字；本次要求和已发生剧情优先。'), text, error, cancel, save); dialog.append(form); root.append(dialog)
  form.onsubmit = async event => { event.preventDefault(); if (!text.value.trim()) { error.textContent = 'AI 创作方向必填'; return }; save.disabled = true; try { await onSaved(current, text.value.trim()); dialog.close() } catch (failure) { error.textContent = failure.message } finally { save.disabled = false } }
  return project => { current = project; text.value = project.premise || ''; error.textContent = ''; showPanelDialog(dialog) }
}
