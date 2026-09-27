import { appendWorkflowReview, reviewFields } from './workflow-review.js'
import { pictureOf } from './drama-model.js'
import { element, appendJsonCopy } from './dom.js'
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
  return { ...episode, id: project.id, episodeId: episode.id, title: project.title, aspectRatio: project.aspectRatio, style: project.style, outputLanguage: project.outputLanguage, script: project.script, projectSummary: project.summary.content, revision: project.revision }

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
  if (pictureOf(item).localPath) return pictureOf(item).localPath
  if (typeof pictureOf(item).imageUrl === 'string' && pictureOf(item).imageUrl.startsWith('/')) return pictureOf(item).imageUrl
  return ''
}

function preview(text) {
  const node = element('p', text, 'summary summary-preview')
  return node
}

const editIcon = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.7 2.3 13.7 6.3 5.4 14.6H1.4v-4L9.7 2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'

export function renderOverview(project, actions, context) {
  const page = element('div', '', 'overview-page')
  const titleRow = element('div', '', 'title-with-edit')
  titleRow.append(element('h2', project.title || '项目概要'))
  const edit = element('button', '', 'icon-edit')
  edit.type = 'button'
  edit.setAttribute('aria-label', '编辑标题、风格和摘要')
  edit.innerHTML = editIcon
  edit.onclick = () => actions.openOverview?.(project)
  titleRow.append(edit)
  page.append(titleRow)
  const style = typeof project.style === 'string' && project.style.trim() ? `${project.style.trim()} · ` : ''
  page.append(element('p', `${project.aspectRatio || '1344x768'} · ${style}${(project.episodes || []).length} 集`, 'meta'))

  const summaryCard = element('article', '', 'overview-card')
  summaryCard.append(element('h3', '摘要'))
  if (project.summary.content) summaryCard.append(preview(project.summary.content))
  page.append(summaryCard)

  const charactersCard = element('article', '', 'overview-card')
  charactersCard.append(element('h3', '人物角色'))
  const characters = collectCharacters(project)
  if (!characters.length) {
    charactersCard.append(element('p', '各集写好的主要人物会显示在这里', 'meta'))
  } else {
    const strip = element('div', '', 'characters-strip')
    strip.addEventListener('wheel', event => {
      if (strip.scrollWidth <= strip.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      strip.scrollLeft += delta
      event.preventDefault()
    }, { passive: false })
    for (const character of characters) {
      const item = element('button', '', 'character-item')
      item.type = 'button'
      item.setAttribute('aria-label', `人物详情：${character.name}`)
      item.onclick = () => context.onOpenCharacter?.(character.episodeId, character.id)
      const avatar = element('div', '', 'character-avatar')
      if (stillSrc(character)) {
        const image = element('img', '', 'character-image')
        image.src = stillSrc(character)
        image.alt = character.name
        avatar.append(image)
      } else {
        avatar.append(element('div', character.name.charAt(0), 'character-image placeholder'))
      }
      item.append(avatar)
      item.append(element('p', character.name, 'character-name'))
      strip.append(item)
    }
    charactersCard.append(strip)
  }
  page.append(charactersCard)

  const script = typeof project.script === 'string' ? project.script.trim() : ''
  if (script) {
    const scriptCard = element('article', '', 'overview-card')
    scriptCard.append(element('h3', '剧本'))
    scriptCard.append(preview(script))
    page.append(scriptCard)
  }

  const episodes = element('article', '', 'overview-card')
  const head = element('div', '', 'episode-head')
  head.append(element('h3', '剧集'))
  const busy = project.activity === 'episode'
  const add = element('button', '＋', 'episode-add')
  add.type = 'button'
  add.disabled = busy
  add.setAttribute('aria-label', '新增剧集')
  add.onclick = () => { if (!busy) actions.openEpisode?.(project, null) }
  head.append(add)
  episodes.append(head)
  const list = [...(project.episodes || [])]
  const placeholder = element('div', '', 'episode-card placeholder')
  if (busy) placeholder.classList.add('is-busy')
  placeholder.tabIndex = 0
  const copy = element('div', '', 'episode-copy')
  copy.append(element('strong', `第 ${list.length + 1} 集`))
  copy.append(element('span', '时长', 'meta'))
  copy.append(element('p', '本集剧情'))
  const generate = element('button', busy ? '生成中' : 'AI生成', 'episode-edit')
  generate.type = 'button'
  generate.disabled = busy
  generate.setAttribute('aria-label', '生成本集剧情')
  generate.onclick = event => {
    event.stopPropagation()
    if (busy || generate.disabled) return
    generate.disabled = true
    generate.textContent = '生成中'
    placeholder.classList.add('is-busy')
    actions.perform(project, 'episode-generate').catch(error => {
      generate.disabled = false
      generate.textContent = 'AI生成'
      placeholder.classList.remove('is-busy')
      actions.fail(error)
    })
  }
  placeholder.append(coverNode({}), copy, generate)
  episodes.append(placeholder)
  list.forEach((episode, index) => {
    const card = element('div', '', 'episode-card')
    card.tabIndex = 0
    card.setAttribute('role', 'link')
    const number = list.length - index
    const copy = element('div', '', 'episode-copy')
    copy.append(element('strong', `第 ${number} 集`))
    copy.append(element('span', `${episode.durationSeconds || 0} 秒`, 'meta'))
    copy.append(element('p', episode.summary.content || '还没有本集剧情'))
    const edit = element('button', '编辑', 'episode-edit')
    edit.type = 'button'
    edit.onclick = event => {
      event.stopPropagation()
      actions.openEpisode?.(project, episode)
    }
    const regenerate = element('button', busy ? '生成中' : '重新生成摘要', 'episode-regenerate')
    regenerate.type = 'button'
    regenerate.disabled = Boolean(project.activity)
    regenerate.setAttribute('aria-label', `重新生成第 ${number} 集摘要`)
    regenerate.title = '重新生成摘要，保留时长；摘要变化后本集下游内容需重新生成'
    regenerate.onclick = event => {
      event.stopPropagation()
      if (regenerate.disabled) return
      regenerate.disabled = true
      regenerate.textContent = '生成中'
      actions.perform(project, 'episode-generate', { episodeId: episode.id, ...reviewFields(copy) }).catch(error => {
        regenerate.disabled = false
        regenerate.textContent = '重新生成摘要'
        actions.fail(error)
      })
    }
    const heading = element('div', '', 'workflow-generation-row')
    heading.append(copy.querySelector('strong'), regenerate)
    copy.prepend(heading)
    const reviewArea = appendWorkflowReview(copy, episode.summary, Boolean(episode.summary.content), Boolean(project.activity), regenerate)
    reviewArea.dataset.episodeId = episode.id
    reviewArea.onclick = event => event.stopPropagation()
    appendJsonCopy(copy, episode)
    card.append(coverNode(episode), copy, edit)
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
  template.innerHTML = `<dialog id="edit-overview" aria-labelledby="edit-overview-title"><div class="modal-head"><h2 id="edit-overview-title">编辑项目</h2><button class="cancel" type="button" aria-label="关闭编辑弹窗">×</button></div><form class="edit"><label for="overview-name">短剧标题</label><input id="overview-name" name="title" required maxlength="100"><label for="overview-aspect">画幅</label><select id="overview-aspect" name="aspect"><option value="1344x768" selected>1344x768</option><option value="768x1344">768x1344</option></select><label for="overview-style">风格</label><input id="overview-style" name="style" maxlength="120" placeholder="例如：写实电影、国风水墨"><label for="overview-summary">摘要</label><textarea id="overview-summary" name="summary" required maxlength="10000"></textarea><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
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
        summary: data.get('summary').trim(),
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
    form.elements.summary.value = project.summary.content || ''
    error.textContent = ''
    dialog.showModal()
  }
}

export function episodeDialog(root, onSaved) {
  const template = document.createElement('template')
  template.innerHTML = `<dialog id="edit-episode" aria-labelledby="edit-episode-title"><div class="modal-head"><h2 id="edit-episode-title">新增剧集</h2><button class="cancel" type="button" aria-label="关闭剧集弹窗">×</button></div><p>填写这一集的剧情和时长。</p><form class="episode"><label for="episode-summary">本集剧情摘要</label><textarea id="episode-summary" name="summary" required maxlength="10000" placeholder="这一集发生什么"></textarea><label for="episode-duration">时长（秒）</label><input id="episode-duration" name="duration" type="number" min="1" max="86400" step="1" required><div class="error" role="alert"></div><footer class="footer"><button type="button" class="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog>`
  root.append(template.content)
  const dialog = root.querySelector('#edit-episode')
  const form = dialog.querySelector('form')
  const error = dialog.querySelector('.error')
  let current = null
  let episode = null
  for (const button of dialog.querySelectorAll('.cancel')) button.onclick = () => dialog.close()
  form.onsubmit = async event => {
    event.preventDefault()
    const button = form.querySelector('[type=submit]')
    button.disabled = true
    error.textContent = ''
    try {
      const data = new FormData(form)
      await onSaved(current, {
        episodeId: episode?.id || '',
        durationSeconds: Number(data.get('duration')),
        summary: data.get('summary').trim(),
      })
      dialog.close()
    } catch (failure) { error.textContent = failure.message }
    finally { button.disabled = false }
  }
  return (project, currentEpisode) => {
    current = project
    episode = currentEpisode
    dialog.querySelector('h2').textContent = currentEpisode ? '编辑剧集' : '新增剧集'
    form.elements.duration.value = currentEpisode ? String(currentEpisode.durationSeconds || '') : ''
    form.elements.summary.value = currentEpisode?.summary || ''
    error.textContent = ''
    dialog.showModal()
  }
}
