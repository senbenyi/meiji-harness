import { shotAssetsEditor } from './shot-assets.js'
import { customSkillField } from './custom-skills.js'
import { appendWorkflowReview, reviewFields } from './workflow-review.js'
import { shotReferenceImages } from './reference-images.js'
import { feedbackOf } from './feedback.js'
import { shotSecondsReady } from './shot-timing.js'
import { stillCards } from './asset-cards.js'
import { characterCard } from './character.js'
import { element, appendJsonCopy } from './dom.js'
import {
  canGenerate, gateMessage, hasBrief, hasCharacters, hasFilm, hasOutline, hasScenes, hasShots, hasStoryboard, stepRunLabel,
} from './flow-view.js'

function bindBusy(button, work, pending = '处理中…') {
  button.type = 'button'
  button.onclick = async () => {
    if (!work || button.disabled) return
    const label = button.textContent
    button.disabled = true
    if (pending) button.textContent = pending
    try { await work() }
    catch (error) {
      button.disabled = false
      button.textContent = label
      throw error
    }
  }
  return button
}

const nextTab = {
  film: ['assembly', '合成'],
}

function stepReady(project, step) {
  return {
    outline: hasOutline(project),
    characters: hasCharacters(project),
    scenes: hasScenes(project),
    shots: hasStoryboard(project),
    film: hasFilm(project),
  }[step]
}

function reviewBar(project, step, context) {
  const bar = element('div', '', 'review-bar')
  const jump = nextTab[step]
  const ready = Boolean(stepReady(project, step))
  const repeatsButton = ready && (step === 'scenes' || step === 'film' || step === 'characters')
  if (!repeatsButton) bar.append(element('p', gateMessage(project, step), 'notice'))
  if (!jump) return bar.childNodes.length ? bar : null
  const button = element('button', `下一步：${jump[1]}`, 'primary')
  button.type = 'button'
  button.disabled = !ready
  button.onclick = () => { if (!button.disabled) context.onGoTab?.(jump[0]) }
  bar.append(button)
  return bar
}

function generateRow(project, step, label, actions, view) {
  if (!canGenerate(project, step)) return null
  const ready = {
    brief: hasBrief(project), outline: hasOutline(project), characters: hasCharacters(project),
    scenes: hasScenes(project), shots: hasShots(project), storyboard: hasStoryboard(project),
  }[step]
  return bindBusy(element('button', ready ? '重新生成' : label, 'primary'), () => actions.perform(project, step, reviewFields(view)), '已送入会话')
}

function field(card, label, value) {
  if (!value) return
  card.append(element('p', `${label}：${value}`, 'meta'))
}

function promptText(prompt) {
  if (!prompt) return ''
  if (typeof prompt === 'string') return prompt.trim()
  if (prompt?.text) return String(prompt.text).trim()
  return [
    `integrated_multimodal_description: ${prompt?.integrated || ''}`,
    '',
    `overall_soundscape: ${prompt?.soundscape || ''}`,
    '',
    `non_diegetic_music: ${prompt?.music || ''}`,
  ].join('\n')
}

function hasBoardPrompt(story) {
  return Boolean(promptText(story?.prompt).trim())
}

function requestLines(project, shot, story) {
  const firstFrame = story?.video === 'first_frame' || story?.link === 'first_last'
  const names = !firstFrame && story?.video !== 'text' ? shotReferenceImages(project, story).map(image => image.url) : []
  const rows = [
    ['model', 'elysium-video'],
    ['prompt', promptText(story?.prompt)],
    ['seconds', String(shot?.duration ?? story?.duration ?? '')],
    ['quality', 'medium'],
    ['input_reference', firstFrame ? '上一镜尾帧' : ''],
    ['last_frame', ''],
    ['reference_images', names.join('\n')],
    ['reference_videos', ''],
    ['reference_audios', ''],
  ]
  return rows.map(([key, value]) => `${key}: ${value || ''}`).join('\n')
}


function renderBrief(project, actions) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  head.append(element('h3', '本集摘要'))
  const regenerate = element('button', project.activity === 'episode' ? '生成中' : '重新生成', 'outline-ai')
  regenerate.disabled = Boolean(project.activity)
  regenerate.setAttribute('aria-label', '重新生成本集摘要')
  regenerate.title = '保留本集时长；摘要变化后下游内容需重新生成'
  bindBusy(regenerate, async () => {
    try { await actions.perform(project, 'episode-generate', { episodeId: project.episodeId, ...reviewFields(view) }) }
    catch (error) { regenerate.disabled = false; regenerate.textContent = '重新生成'; actions.fail(error) }
  }, '生成中')
  head.append(regenerate)
  view.append(head)
  if (project.summary) view.append(element('p', project.summary, 'summary'))
  if (project.summary) appendJsonCopy(view, { summary: project.summary, durationSeconds: project.durationSeconds })
  appendWorkflowReview(view, feedbackOf(project, 'summary'), Boolean(project.summary), Boolean(project.activity))
  return view
}

function renderOutline(project, actions) {
  const view = element('section', '', 'session-project')
  view.append(customSkillField(project, 'outline', actions))
  const title = element('div', '', 'title-with-edit')
  title.append(element('h3', '故事大纲'))
  if (hasOutline(project)) {
    const edit = element('button', '', 'icon-edit')
    edit.type = 'button'
    edit.setAttribute('aria-label', '编辑大纲')
    edit.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.7 2.3 13.7 6.3 5.4 14.6H1.4v-4L9.7 2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    edit.onclick = () => actions.openStory(project)
    title.append(edit)
  }
  const head = element('div', '', 'outline-head')
  head.append(title)
  const busy = project.activity === 'outline'
  const generate = element('button', busy ? '生成中' : 'AI生成', 'outline-ai')
  generate.type = 'button'
  generate.disabled = busy || !canGenerate(project, 'outline')
  generate.setAttribute('aria-label', '生成故事大纲')
  generate.onclick = () => {
    if (generate.disabled) return
    generate.disabled = true
    generate.textContent = '生成中'
    actions.perform(project, 'outline', reviewFields(view)).catch(error => {
      generate.disabled = false
      generate.textContent = 'AI生成'
      actions.fail(error)
    })
  }
  head.append(generate)
  view.append(head, element('p', stepRunLabel(project, 'outline'), 'story-status'))
  if (hasOutline(project)) {
    view.append(element('pre', project.outline, 'story'))
    appendJsonCopy(view, { outline: project.outline })
  }
  appendWorkflowReview(view, feedbackOf(project, 'outline'), hasOutline(project), Boolean(project.activity))
  return view
}

function renderCharacters(project, actions, context) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  const title = element('div', '', 'asset-stage-title')
  title.append(element('h3', '角色卡'), element('span', stepRunLabel(project, 'characters'), 'story-status'))
  head.append(title)
  const button = generateRow(project, 'characters', '写角色卡', actions, view)
  if (button) head.append(button)
  view.append(head)
  const hint = element('p', hasCharacters(project) ? '' : gateMessage(project, 'characters'), 'hint')
  hint.hidden = !hint.textContent
  view.append(hint)
  const cards = element('div', '', 'character-list')
  for (const item of project.characters?.items || []) cards.append(characterCard(project, item, actions, context))
  view.append(cards)
  const charactersNext = reviewBar(project, 'characters', context)
  if (charactersNext) view.append(charactersNext)
  appendWorkflowReview(view, feedbackOf(project, 'characters'), hasCharacters(project), Boolean(project.activity))
  return view
}

function renderScenes(project, actions, context) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  const title = element('div', '', 'asset-stage-title')
  title.append(element('h3', '场景卡'), element('span', stepRunLabel(project, 'scenes'), 'story-status'))
  head.append(title)
  const button = generateRow(project, 'scenes', '写场景卡', actions, view)
  if (button) head.append(button)
  view.append(head, element('p', '最多两张重要场景。图片只上传这两张。', 'meta'))
  const hint = element('p', hasScenes(project) ? '' : gateMessage(project, 'scenes'), 'hint')
  hint.hidden = !hint.textContent
  view.append(hint)
  for (const node of stillCards(project, project.scenes?.items || [], actions, hint)) view.append(node)
  const scenesNext = reviewBar(project, 'scenes', context)
  if (scenesNext) view.append(scenesNext)
  appendWorkflowReview(view, feedbackOf(project, 'scenes'), hasScenes(project), Boolean(project.activity))
  return view
}

const shotPanes = [
  ['table', '镜头表'],
  ['seconds', '每秒指令'],
  ['board', '文本分镜'],
  ['pencil', '铅笔分镜'],
]

function regenRow(card, { busy, enabled, label, onRun, review = '', check, generated }) {
  const title = card.querySelector('h3')
  const head = element('div', '', 'shot-head')
  if (title) head.append(title)
  const button = element('button', busy ? '生成中' : label, 'primary')
  button.type = 'button'
  button.disabled = busy || !enabled
  head.append(button)
  card.prepend(head)
  const hint = element('p', '', 'hint warn')
  hint.hidden = true
  button.onclick = () => {
    if (button.disabled) return
    const review = reviewFields(card).review
    button.disabled = true
    button.textContent = '生成中'
    hint.hidden = true
    onRun(review).catch(error => {
      button.disabled = false
      button.textContent = label
      hint.hidden = false
      hint.textContent = error.message
    })
  }
  appendWorkflowReview(card, { check, review: { text: review } }, generated, busy)
  card.append(hint)
}

function renderShots(project, actions, context = {}) {
  const view = element('section', '', 'session-project')
  const panes = element('nav', '', 'shot-subtabs')
  panes.setAttribute('aria-label', '镜头内容')
  let active = shotPanes.some(([id]) => id === context.shotsPane) ? context.shotsPane : 'table'
  const paint = () => {
    panes.replaceChildren()
    for (const [id, label] of shotPanes) {
      const button = element('button', label)
      button.type = 'button'
      if (id === active) button.setAttribute('aria-current', 'step')
      button.onclick = () => { active = id; context.onShotsPane?.(id); paint() }
      panes.append(button)
    }
    for (const node of [...view.children]) if (node !== panes) node.remove()
    const stage = { table: 'shots', seconds: 'seconds', board: 'storyboard' }[active]
    if (stage) view.append(customSkillField(project, stage, actions))
    if (active === 'table') paintShotTable(view, project, actions)
    else if (active === 'seconds') paintSeconds(view, project, actions)
    else if (active === 'board') paintBoards(view, project, actions)
    else paintPencils(view, project, actions)
  }
  view.append(panes)
  paint()
  return view
}

function paintShotTable(view, project, actions) {
  view.append(element('p', stepRunLabel(project, 'shots'), 'story-status'))
  const tableBusy = Boolean(project.activity)
  if (canGenerate(project, 'shots')) {
    const hasTable = hasShots(project)
    const label = hasTable ? '重新生成' : '写镜头表'
    const button = element('button', project.activity === 'shots' ? '生成中' : label, 'primary')
    button.type = 'button'
    button.disabled = tableBusy
    bindBusy(button, () => actions.perform(project, 'shots', reviewFields(view)), '生成中')
    view.append(button)

  }
  for (const shot of project.shots?.items || []) view.append(shotTableCard(shot))
  appendWorkflowReview(view, feedbackOf(project, 'shots'), hasShots(project), tableBusy)
}

function shotTableCard(shot) {
  const card = element('article', '', 'shot-card')
  const hookLabels = {
    setup: '铺垫', 'visual-joke': '视觉笑点', reversal: '反转', reveal: '揭示',
    callback: '呼应', suspense: '悬念', tender: '温情', chase: '追逐',
    'expression-beat': '表情节拍', climax: '高潮',
  }
  card.append(element('h3', `${shot.id} / ${shot.duration}s${shot.hook ? ` · ${hookLabels[shot.hook] || shot.hook}` : ''}`))
  if (shot.format === 'text') {
    card.append(element('p', shot.text || '还未生成', 'prompt full'))
    appendJsonCopy(card, shot.text)
    return card
  }
  field(card, '连续性衔接', shot.continuity)
  field(card, '固定地标', shot.anchors?.landmark)
  field(card, '人物位置', shot.anchors?.positions)
  field(card, '退场人物', shot.anchors?.exited)
  field(card, '光位基线', shot.anchors?.light)
  field(card, '角色', (shot.cast || []).join('、'))
  field(card, '旁白', shot.audio?.voiceover)
  field(card, '对白', shot.audio?.dialogue)
  field(card, '音效', shot.audio?.sfx)
  field(card, '表演', shot.audio?.performance)
  appendJsonCopy(card, shot)
  return card
}

function paintSeconds(view, project, actions) {
  const shots = project.shots?.items || []
  if (!shots.length) {
    appendWorkflowReview(view, feedbackOf(project, 'seconds'), false)
    return
  }
  const busy = Boolean(project.activity)
  const ready = shots.every(shotSecondsReady)
  const writing = project.activity === 'seconds'
  const all = element('button', writing ? '生成中' : ready ? '重新生成' : '生成每秒指令', 'primary')
  all.type = 'button'
  all.disabled = busy
  all.onclick = () => {
    if (all.disabled) return
    all.disabled = true
    all.textContent = '生成中'
    actions.perform(project, 'seconds').catch(error => {
      all.disabled = false
      all.textContent = ready ? '重新生成' : '生成每秒指令'
      actions.fail(error)
    })
  }
  view.append(all)
  for (const shot of shots) {
    const card = element('article', '', 'shot-card')
    card.append(element('h3', `${shot.id} / ${shot.duration}s`))
    const ready = shotSecondsReady(shot)
    if (shot.secondsText) card.append(element('p', shot.secondsText, 'prompt full'))
    for (const second of shot.seconds || []) {
      card.append(element('p', `${second.range} 动作：${second.action}｜镜头：${second.camera}｜空间：${second.space}｜音频：${second.audio}｜交接：${second.handoff}`, 'prompt full'))
    }
    regenRow(card, {
      busy: project.activity === `shot-seconds:${shot.id}`,
      enabled: !busy,
      label: ready ? '重新生成' : '生成',
      review: feedbackOf(project, { action: 'shot-seconds', track: shot.id }).review.text,
      check: feedbackOf(project, { action: 'shot-seconds', track: shot.id }).check,
      generated: Boolean(shot.secondsText || shot.seconds?.length),
      onRun: review => actions.perform(project, 'shot-seconds', { track: shot.id, review }),
    })
    appendJsonCopy(card, shot.secondsText || { id: shot.id, duration: shot.duration, seconds: shot.seconds })
    view.append(card)
  }
}

function paintBoards(view, project, actions) {
  const shots = project.shots?.items || []
  if (!shots.length) appendWorkflowReview(view, feedbackOf(project, 'storyboard'), false)
  const tableBusy = Boolean(project.activity)
  if (hasShots(project)) {
    const boarding = project.activity === 'storyboard'
    const all = element('button', boarding ? '生成中' : '全部生成文本分镜', 'primary')
    all.type = 'button'
    all.disabled = tableBusy || !canGenerate(project, 'storyboard')
    all.onclick = () => {
      if (all.disabled) return
      all.disabled = true
      all.textContent = '生成中'
      actions.perform(project, 'storyboard').catch(error => {
        all.disabled = false
        all.textContent = '全部生成文本分镜'
        actions.fail(error)
      })
    }
    view.append(all)
  }
  for (const shot of shots) {
    const story = (project.storyboard || []).find(item => item.id === shot.id)
    const secondsReady = shotSecondsReady(shot)
    const card = element('article', '', 'shot-card')
    card.append(element('h3', `${shot.id} / ${shot.duration}s${story?.title ? ` · ${story.title}` : ''}`))
    card.append(shotAssetsEditor(project, shot, actions))
    if (story) field(card, '视频生成模式', videoModeLabel(story))
    if (story && hasBoardPrompt(story)) card.append(element('p', requestLines(project, shot, story), 'prompt full'))
    regenRow(card, {
      busy: project.activity === `shot-storyboard:${shot.id}`,
      enabled: secondsReady && !tableBusy,
      label: story ? '重新生成' : '生成',
      review: feedbackOf(project, { action: 'shot-storyboard', track: shot.id }).review.text,
      check: feedbackOf(project, { action: 'shot-storyboard', track: shot.id }).check,
      generated: Boolean(story && hasBoardPrompt(story)),
      onRun: review => actions.perform(project, 'shot-storyboard', { track: shot.id, review }),
    })
    appendJsonCopy(card, story?.format === 'text' ? story.prompt.text : story)
    view.append(card)
  }
}

function paintPencils(view, project, actions) {
  const shots = project.shots?.items || []
  if (!shots.length) appendWorkflowReview(view, feedbackOf(project, 'pencil'), false)
  const activity = project.activity || ''
  for (const shot of shots) {
    const story = (project.storyboard || []).find(item => item.id === shot.id)
    const boardReady = hasBoardPrompt(story)
    const drawing = project.boards?.[shot.id]
    const drawingNow = activity === `pencil:${shot.id}`
    const card = element('article', '', 'shot-card')
    const head = element('div', '', 'outline-head')
    head.append(element('h3', `${shot.id} / ${shot.duration}s`))
    head.append(aiButton(actions, drawingNow, boardReady && !activity, () => actions.beginImage(project, 'pencil', { track: shot.id, ...reviewFields(card) })))
    card.append(head)
    if (!boardReady) card.append(element('p', '先写好这一镜的文本分镜。', 'meta'))
    if (drawing?.url) mountPencil(card, drawing.url, `${shot.id} 铅笔分镜`)
    else card.append(element('p', drawingNow ? '正在画出这一镜的全部格子。' : '生成后整张草图会显示在这里。', 'meta'))
    appendWorkflowReview(card, feedbackOf(project, { action: 'pencil', track: shot.id }), Boolean(drawing?.url), Boolean(project.activity))
    appendJsonCopy(card, drawing)
    view.append(card)
  }
}

function mountPencil(parent, url, label) {
  const preview = document.createElement('dialog')
  preview.className = 'still-preview'
  const closePreview = element('button', '×', 'cancel')
  closePreview.type = 'button'
  closePreview.setAttribute('aria-label', '关闭大图')
  const full = document.createElement('img')
  full.alt = label
  preview.append(closePreview, full)
  closePreview.onclick = () => preview.close()
  preview.addEventListener('click', event => { if (event.target === preview) preview.close() })
  const open = element('button', '', 'pencil-open')
  open.type = 'button'
  open.setAttribute('aria-label', `查看全图：${label}`)
  const sheet = document.createElement('img')
  sheet.className = 'pencil-sheet'
  sheet.alt = label
  sheet.src = url
  open.append(sheet)
  open.onclick = () => { full.src = url; preview.showModal() }
  parent.append(preview, open)
}

function renderFilm(project, actions, context) {
  const view = element('section', '', 'session-project')
  view.append(element('h3', '成片'), customSkillField(project, 'film', actions))
  if (!project.storyboard?.length) appendWorkflowReview(view, feedbackOf(project, 'films'), false)
  if ((project.storyboard || []).length) {
    const filmingAll = project.activity === 'films'
    const all = element('button', filmingAll ? '生成中' : '一键成片', 'primary')
    all.type = 'button'
    all.disabled = Boolean(project.activity) || !canGenerate(project, 'film')
    all.onclick = () => {
      if (all.disabled) return
      all.disabled = true
      all.textContent = '生成中'
      actions.perform(project, 'films').catch(error => {
        all.disabled = false
        all.textContent = '一键成片'
        actions.fail(error)
      })
    }
    view.append(all)
  }
  for (const item of project.storyboard || []) {
    const card = element('article', '', 'shot-card')
    const head = element('div', '', 'title-row')
    head.append(element('h3', `${item.id} / ${item.duration}s — ${item.title}`))
    const clip = project.films?.[item.id]
    const running = clip?.status === 'running' || project.activity === `film:${item.id}` || project.activity === 'films'
    if (clip?.status === 'stale') card.append(element('p', '参考内容已更改，当前视频为旧版本，请重新生成。', 'notice'))
    const interrupted = clip?.status === 'interrupted'
    const button = element('button', running ? '生成中' : interrupted ? '重新生成' : '成片', 'primary')
    if (!hasBoardPrompt(item) || feedbackOf(project, `storyboard:${item.id}`).check.passed === false || feedbackOf(project, 'storyboard').check.passed === false || running || project.activity) button.disabled = true
    else bindBusy(button, () => actions.perform(project, 'film', { track: item.id, ...reviewFields(card) }), '已送入会话')
    head.append(button)
    card.append(head)
    if ((clip?.status === 'error' || clip?.status === 'interrupted') && clip.error) card.append(element('p', clip.error, 'notice'))
    if (clip?.url) {
      const video = element('video')
      video.controls = true
      video.playsInline = true
      video.src = clip.url
      card.append(video)
    } else if (running) card.append(element('p', '这一镜正在生成，完成后显示在这张卡片上。', 'notice'))
    appendWorkflowReview(card, feedbackOf(project, { action: 'film', track: item.id }), Boolean(clip?.url), running)
    appendJsonCopy(card, clip)
    view.append(card)
  }
  view.append(reviewBar(project, 'film', context))
  return view
}

function renderAssembly(project, actions) {
  const view = element('section', '', 'session-project')
  view.append(element('h3', '合成'), element('p', gateMessage(project, 'assembly'), 'notice'))
  const concatCard = element('article', '', 'shot-card')
  concatCard.append(element('h3', '全片拼接'), element('p', '按镜头顺序用 FFmpeg 把成片接成一条。', 'meta'))
  const busy = project.activity === 'assemble'
  const button = element('button', busy ? '拼接中' : '全片拼接', 'primary')
  button.type = 'button'
  button.disabled = busy || Boolean(project.activity) || !hasFilm(project)
  button.onclick = () => {
    if (button.disabled) return
    button.disabled = true
    button.textContent = '拼接中'
    actions.perform(project, 'assemble', reviewFields(concatCard)).catch(error => {
      button.disabled = false
      button.textContent = '全片拼接'
      actions.fail(error)
    })
  }
  concatCard.append(button)
  if (project.assembly?.error) concatCard.append(element('p', project.assembly.error, 'notice'))
  if (project.assembly?.status === 'stale') concatCard.append(element('p', '上游内容已更改，此合成视频为旧版本，请重新生成成片并合成。', 'notice'))
  if (project.assembly?.url) {
    const video = element('video')
    video.controls = true
    video.playsInline = true
    video.src = project.assembly.url
    concatCard.append(video)
  }
  appendWorkflowReview(concatCard, feedbackOf(project, 'assembly'), Boolean(project.assembly?.url), busy)
  appendJsonCopy(concatCard, project.assembly)
  view.append(concatCard)
  const music = element('article', '', 'shot-card')
  music.append(element('h3', '背景音乐'), element('p', '给成片配一条角色听不见的音乐。当前没有音乐模型。', 'meta'))
  const later = element('button', '后期接入')
  later.type = 'button'
  later.disabled = true
  music.append(later)
  view.append(music)
  return view
}

function stack(sections) {
  const view = element('div', '', 'stage-stack')
  for (const section of sections) view.append(section)
  return view
}

const renderers = {
  script: (project, actions) => stack([renderBrief(project, actions), renderOutline(project, actions)]),
  cast: (project, actions, context) => stack([renderCharacters(project, actions, context), renderScenes(project, actions, context)]),
  shots: renderShots,
  film: renderFilm,
  assembly: renderAssembly,
}

export function renderStage(step, project, actions, context) {
  return (renderers[step] || renderers.script)(project, actions, context)
}

function panelLine(panel) {
  const bits = [`姿态：${panel.pose}`, `镜头：${panel.camera}`]
  if (panel.space) bits.push(`空间：${panel.space}`)
  bits.push(`音频：${panel.audio}`)
  if (panel.handoff) bits.push(`交接：${panel.handoff}`)
  return `${panel.time} ${bits.join('｜')}`
}

function aiButton(actions, busy, enabled, run) {
  const button = element('button', busy ? '生成中' : 'AI生成', 'outline-ai')
  button.type = 'button'
  button.disabled = busy || !enabled
  button.onclick = () => {
    if (button.disabled) return
    button.disabled = true
    button.textContent = '生成中'
    run().catch(error => {
      button.disabled = false
      button.textContent = 'AI生成'
      actions.fail(error)
    })
  }
  return button
}

export function renderShotPage(project, shot, actions, context = {}) {
  const fragment = document.createDocumentFragment()
  const bar = element('div', '', 'episode-bar')
  const back = element('button', '←', 'episode-back')
  back.type = 'button'
  back.setAttribute('aria-label', '返回镜头')
  back.onclick = () => context.onBackShot?.()
  bar.append(back, element('h2', `${shot.id} · ${shot.duration}秒`))
  const nav = element('nav', '', 'stage-overview')
  nav.setAttribute('aria-label', '分镜详情')
  const body = element('div', '', 'session-body')
  const tabs = [
    ['seconds', '每秒指令'],
    ['board', '文本分镜'],
    ['boards', '铅笔分镜'],
    ['film', '成片'],
  ]
  let active = ['seconds', 'board', 'boards', 'film'].includes(context.shotTab) ? context.shotTab : 'seconds'
  const story = (project.storyboard || []).find(item => item.id === shot.id)
  const secondsReady = shotSecondsReady(shot)
  const boardReady = hasBoardPrompt(story)
  const paint = () => {
    nav.replaceChildren()
    for (const [id, label] of tabs) {
      const button = element('button', label, 'stage')
      button.type = 'button'
      if (id === active) button.setAttribute('aria-current', 'step')
      button.onclick = () => { active = id; context.onShotTab?.(id); paint() }
      nav.append(button)
    }
    const pane = element('section', '', 'session-project')
    const customStage = { seconds: 'seconds', board: 'storyboard', film: 'film' }[active]
    if (customStage) pane.append(customSkillField(project, customStage, actions))
    if (active === 'board') pane.append(shotAssetsEditor(project, shot, actions))
    const activity = project.activity || ''
    if (active === 'seconds') {
      const head = element('div', '', 'outline-head')
      head.append(element('h3', '每秒指令'))
      head.append(aiButton(actions, activity === `shot-seconds:${shot.id}`, !activity, () => actions.perform(project, 'shot-seconds', { track: shot.id, ...reviewFields(pane) })))
      pane.append(head, element('p', '动作、镜头、空间、音频、交接。写满后原样进入文本分镜。', 'meta'))
      if (shot.secondsText) pane.append(element('p', shot.secondsText, 'prompt full'))
      for (const second of shot.seconds || []) {
        pane.append(element('p', `${second.range} 动作：${second.action}｜镜头：${second.camera}｜空间：${second.space}｜音频：${second.audio}｜交接：${second.handoff}`, 'prompt'))
      }
    } else if (active === 'board') {
      const head = element('div', '', 'outline-head')
      head.append(element('h3', '文本分镜'))
      head.append(aiButton(actions, activity === `shot-storyboard:${shot.id}`, secondsReady && !activity, () => actions.perform(project, 'shot-storyboard', { track: shot.id, ...reviewFields(pane) })))
      pane.append(head)
      if (story) {
        field(pane, '标题', story.title)
        field(pane, '视频生成模式', videoModeLabel(story))
        field(pane, '场景与角色', `${story.scene || ''}｜${(story.characters || []).join('、')}`)
        field(pane, '承接', story.carryIn)
        field(pane, '交接', story.carryOut)
        for (const panel of story.panels || []) pane.append(element('p', panelLine(panel), 'prompt'))
        pane.append(element('p', promptText(story.prompt), 'prompt'))
      }
    } else if (active === 'boards') {
      const drawing = project.boards?.[shot.id]
      const drawingNow = activity === `pencil:${shot.id}`
      const head = element('div', '', 'outline-head')
      head.append(element('h3', '铅笔分镜'))
      head.append(aiButton(actions, drawingNow, boardReady && !activity, () => actions.beginImage(project, 'pencil', { track: shot.id, ...reviewFields(pane) })))
      pane.append(head)
      if (!boardReady) pane.append(element('p', '先写好这一镜的文本分镜，再出铅笔分镜。', 'meta'))
      else pane.append(element('p', `这一镜 ${shot.duration} 秒，按时间顺序绘制关键画面。`, 'meta'))
      if (drawing?.url) mountPencil(pane, drawing.url, `${shot.id} 铅笔分镜`)
      else if (!drawingNow) pane.append(element('p', '生成后整张草图会显示在这里，点击可以看全图。', 'meta'))
      else pane.append(element('p', '正在画出这一镜的全部格子。', 'notice'))
    } else {
      const clip = project.films?.[shot.id]
      if (clip?.status === 'stale') pane.append(element('p', '参考内容已更改，此视频为旧版本，请重新生成。', 'notice'))
      const filming = clip?.status === 'running' || activity === `film:${shot.id}`
      const head = element('div', '', 'outline-head')
      head.append(element('h3', '成片'))
      const generate = aiButton(actions, filming, boardReady && feedbackOf(project, `storyboard:${shot.id}`).check.passed !== false && feedbackOf(project, 'storyboard').check.passed !== false && !activity, () => actions.perform(project, 'film', { track: shot.id, ...reviewFields(pane) }))
      if (clip?.status === 'interrupted' && !filming) generate.textContent = '重新生成'
      head.append(generate)
      pane.append(head)
      if (!boardReady) pane.append(element('p', '先写好这一镜的文本分镜，再提交成片。', 'meta'))
      if ((clip?.status === 'error' || clip?.status === 'interrupted') && clip.error) pane.append(element('p', clip.error, 'notice'))
      if (clip?.url) {
        const video = element('video')
        video.controls = true
        video.playsInline = true
        video.src = clip.url
        pane.append(video)
      } else if (filming) pane.append(element('p', '这一镜正在生成。', 'notice'))
    }
    const json = active === 'seconds' ? (shot.secondsText || { id: shot.id, duration: shot.duration, seconds: shot.seconds })
      : active === 'board' ? story : active === 'boards' ? project.boards?.[shot.id] : project.films?.[shot.id]
    appendJsonCopy(pane, active === 'board' && story?.format === 'text' ? story.prompt.text : json)
    const target = { action: { seconds: 'shot-seconds', board: 'shot-storyboard', boards: 'pencil', film: 'film' }[active], track: shot.id }
    const generated = active === 'seconds' ? Boolean(shot.secondsText || shot.seconds?.length) : active === 'board' ? Boolean(story && hasBoardPrompt(story)) : Boolean(json?.url)
    appendWorkflowReview(pane, feedbackOf(project, target), generated, Boolean(activity))
    body.replaceChildren(pane)
  }
  fragment.append(bar, nav, body)
  paint()
  return fragment
}

function videoModeLabel(story) {
  return { text: '文生视频', first_frame: '首尾帧（承接上一镜尾帧）', reference: '多模态（参考图片）' }[story.video] || '未指定，请重新生成文本分镜'
}
