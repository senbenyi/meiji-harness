import { historyEntry } from './execution-history.js'
import { GenerationStatus, statusLabels } from '../shared/drama-model.js'
import { videoPromptText as promptText } from '../shared/video-prompt-text.js'
import { videoSizeOf } from '../shared/project-rules.js'
import { decorateShotCard } from './shot-card-state.js'
import { shotResults, shotMap } from '../shared/drama-model.js'
import { storyboardReferences } from './storyboard-references.js'
import { storyboardEditor } from './storyboard-editor.js'
import { textShotView } from './text-shot-view.js'
import { skillField } from './skill-entry.js'
import { appendWorkflowReview, reviewFields } from './workflow-review.js'
import { shotReferenceImages } from '../shared/reference-images.js'
import { feedbackOf } from '../shared/feedback.js'
import { shotSecondsReady } from '../shared/shot-timing.js'
import { stillCards } from './asset-cards.js'
import { characterCard } from './character.js'
import { showPanelDialog, element, appendJsonCopy } from './dom.js'
import {
  canGenerate, gateMessage, hasSummary, hasCharacters, hasFilm, hasOutline, hasScenes, hasShots, hasStoryboard, stepRunLabel,
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
    summary: hasSummary(project), outline: hasOutline(project), characters: hasCharacters(project),
    scenes: hasScenes(project), shots: hasShots(project), storyboard: hasStoryboard(project),
  }[step]
  return bindBusy(element('button', ready ? '重新生成' : label, 'primary'), () => actions.perform(project, step, reviewFields(view)), '任务已启动')
}

function field(card, label, value) {
  if (!value) return
  card.append(element('p', `${label}：${value}`, 'meta'))
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
    ['size', videoSizeOf(project?.aspectRatio)],
    ['input_reference', firstFrame ? '上一镜尾帧' : ''],
    ['last_frame', ''],
    ['reference_images', names.length ? `${names.join('\n')}\n（提交时按顺序读取本地图片，转为 base64 data URL）` : ''],
    ['reference_videos', ''],
    ['reference_audios', ''],
  ]
  return rows.map(([key, value]) => `${key}: ${value || ''}`).join('\n')
}


function renderBrief(project, actions) {
  const view = element('section', '', 'session-project episode-summary')
  view.dataset.modelKey = `summary:${project.episodeId}`
  const head = element('div', '', 'outline-head')
  head.append(element('h3', '本集摘要'))
  const edit = element('button', '编辑摘要')
  edit.type = 'button'
  edit.disabled = Boolean(project.activity)
  edit.onclick = () => actions.openEpisode(project, {
    id: project.episodeId, summary: project.summary, durationSeconds: project.durationSeconds,
  })
  const regenerate = element('button', project.activity === 'episode' ? '生成中' : '重新生成', 'primary')
  regenerate.disabled = Boolean(project.activity)
  bindBusy(regenerate, async () => {
    try { await actions.perform(project, 'episode-generate', { episodeId: project.episodeId, ...reviewFields(view) }) }
    catch (error) { regenerate.disabled = false; regenerate.textContent = '重新生成'; actions.fail(error) }
  }, '生成中')
  const controls = element('div', '', 'section-actions')
  controls.append(edit, regenerate)
  head.append(controls)
  view.append(head, skillField(project, 'summary', actions))
  if (project.summary.content) view.append(element('p', project.summary.content, 'summary'))
  appendWorkflowReview(view, feedbackOf(project, 'summary'), Boolean(project.summary.content), Boolean(project.activity), regenerate, { allowFailureOpinion: true })
  return view
}

function storyNodeActions(project, actions, stage) {
  const row = element('div', '', 'story-node-actions')
  row.append(skillField(project, stage, actions).querySelector('button'))
  return row
}

function renderOutline(project, actions) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  const title = element('div', '', 'asset-stage-title')
  title.append(element('h3', '故事大纲'), element('span', stepRunLabel(project, 'outline'), 'story-status'))
  head.append(title, storyNodeActions(project, actions, 'outline'))
  view.append(head)
  if (hasOutline(project)) {
    view.dataset.modelKey = `outline:${project.episodeId}`
    view.append(element('pre', project.plot.outline.content, 'story'))
    appendJsonCopy(view, { outline: project.plot.outline.content })
  }
  return view
}

function renderStory(project, actions, context) {
  const controls = element('section', '', 'session-project story-controls')
  const head = element('div', '', 'outline-head')
  head.append(element('h3', '剧情生成与审核'))
  const generated = hasOutline(project) || hasCharacters(project) || hasScenes(project)
  const label = generated ? '重新生成剧情' : '生成剧情'
  const generate = element('button', project.activity === 'outline' ? '生成中' : label, 'primary')
  generate.disabled = Boolean(project.activity) || !canGenerate(project, 'outline')
  bindBusy(generate, async () => {
    try { await actions.perform(project, 'outline', reviewFields(controls)) }
    catch (error) { generate.disabled = false; generate.textContent = label; actions.fail(error) }
  }, '生成中')
  head.append(generate)
  controls.append(head, element('p', '依次生成并审核大纲、提取人物角色、提取场景，各步骤独立调用模型。下方意见用于本次剧情修改。', 'meta'))
  const review = appendWorkflowReview(controls, feedbackOf(project, 'outline'), generated, Boolean(project.activity), generate, { allowFailureOpinion: true })
  const input = review.querySelector('input')
  if (input) input.placeholder = '填写剧情、角色或场景的修改意见'
  generate.textContent = project.activity === 'outline' ? '生成中' : label
  generate.setAttribute('aria-label', label)
  return stack([controls, renderOutline(project, actions), renderCharacters(project, actions, context), renderScenes(project, actions, context)])
}

function renderCharacters(project, actions, context) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  const title = element('div', '', 'asset-stage-title')
  title.append(element('h3', '角色卡'), element('span', stepRunLabel(project, 'characters'), 'story-status'))
  head.append(title, storyNodeActions(project, actions, 'characters'))
  view.append(head)
  const hint = element('p', hasCharacters(project) ? '' : gateMessage(project, 'characters'), 'hint')
  hint.hidden = !hint.textContent
  view.append(hint)
  const cards = element('div', '', 'character-list')
  for (const item of project.plot.characters?.items || []) cards.append(characterCard(project, item, actions, context))
  view.append(cards)
  if (!hasCharacters(project)) view.append(element('p', '未生成：点击页面顶部生成剧情，依次完成大纲、人物提取和场景提取。', 'meta'))
  return view
}

export function renderSceneDetail(project, itemId, actions, context) {
  const page = element('section', '', 'session-project character-detail')
  const head = element('div', '', 'episode-bar')
  const back = element('button', '←', 'episode-back')
  back.type = 'button'
  back.setAttribute('aria-label', '返回场景列表')
  back.onclick = () => context.onBackScene?.()
  const item = project?.plot?.scenes?.items?.find(scene => scene.id === itemId)
  head.append(back, element('h2', item ? `${item.name} · 场景详情` : '场景详情'))
  page.append(head)
  if (!item) {
    page.append(element('p', '该场景已不存在，请返回列表重新选择。', 'notice'))
    return page
  }
  page.append(element('p', '场景资料与形象管理', 'meta'))
  const hint = element('p', /^(自检|自审)未通过/.test(project.activityError || '') ? '' : project.activityError || '', 'hint warn')
  hint.hidden = !hint.textContent
  hint.setAttribute('role', 'status')
  page.append(hint, ...stillCards(project, [item], actions, hint, { editable: true, imageGate: context.detailGate }))
  return page
}

function renderScenes(project, actions, context) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  const title = element('div', '', 'asset-stage-title')
  title.append(element('h3', '场景卡'), element('span', stepRunLabel(project, 'scenes'), 'story-status'))
  head.append(title, storyNodeActions(project, actions, 'scenes'))
  view.append(head, element('p', '按剧情需要管理场景；各镜头仅关联实际使用的场景图片。', 'meta'))
  const hint = element('p', hasScenes(project) ? '' : gateMessage(project, 'scenes'), 'hint')
  hint.hidden = !hint.textContent
  view.append(hint)
  const list = element('div', '', 'scene-list')
  for (const node of stillCards(project, project.plot.scenes?.items || [], actions, hint, { onOpen: id => context.onOpenScene?.(project.episodeId, id) })) (node.tagName === 'DIALOG' || node.tagName === 'INPUT' ? view : list).append(node)
  view.append(list)
  if (!hasScenes(project)) view.append(element('p', '未生成：点击页面顶部生成剧情，依次完成大纲、人物提取和场景提取。', 'meta'))
  return view
}

function regenRow(card, { busy, enabled, label, onRun, review = '', check, generated, record }) {
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
    const fields = reviewFields(card)
    button.disabled = true
    button.textContent = '生成中'
    hint.hidden = true
    onRun(fields).catch(error => {
      button.disabled = false
      button.textContent = label
      hint.hidden = false
      hint.textContent = error.message
    })
  }
  appendWorkflowReview(card, record, generated, busy, button)
  card.append(hint)
}

function renderShots(project, actions, stage = 'shots') {
  const view = element('section', '', 'session-project')
  view.append(skillField(project, stage, actions))
  if (stage === 'shots') paintShotTable(view, project, actions)
  else paintSeconds(view, project, actions)
  view.querySelectorAll(':scope > .shot-card').forEach((card, index) => {
    const shot = project.shots.items[index]
    const model = stage === 'shots' ? (shot.check.passed === null ? project.shots : shot) : shot.seconds
    decorateShotCard(card, model, shot.id, index === 0)
  })
  return view
}

function paintShotTable(view, project, actions) {
  const heading = element('div', '', 'workflow-generation-row')
  heading.append(element('span', stepRunLabel(project, 'shots'), 'story-status'))
  view.append(heading)
  const tableBusy = Boolean(project.activity)
  if (canGenerate(project, 'shots')) {
    const hasTable = hasShots(project)
    const label = hasTable ? '重新生成' : '写镜头表'
    const button = element('button', project.activity === 'shots' ? '生成中' : label, 'primary')
    button.type = 'button'
    button.disabled = tableBusy
    bindBusy(button, () => actions.perform(project, 'shots', reviewFields(view)), '生成中')
    heading.append(button)

  }
  appendWorkflowReview(view, feedbackOf(project, 'shots'), hasShots(project) || Boolean(project.shots?.failedOutput), tableBusy, heading.querySelector('button.primary'))
  for (const shot of project.shots?.items || []) view.append(shotTableCard(shot))
  if (!hasShots(project) && project.shots?.failedOutput) view.append(element('pre', project.shots.failedOutput, 'story'))
}

function shotHeading(shot) {
  const titleLine = String(shot.content || '').match(/^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(?:标题|Title)(?:\*\*)?[ \t]*[:：][ \t]*(.+)$/im)
  const title = (titleLine?.[1] || shot.title || '').replace(/^\*\*|\*\*$/g, '').trim()
  return `${shot.id} / ${shot.duration}s${title ? ` · ${title}` : ''}`
}

function shotTableCard(shot) {
  const card = element('article', '', 'shot-card')
    card.dataset.modelKey = `shot:${shot.id}`
  const hookLabels = {
    setup: '铺垫', 'visual-joke': '视觉笑点', reversal: '反转', reveal: '揭示',
    callback: '呼应', suspense: '悬念', tender: '温情', chase: '追逐',
    'expression-beat': '表情节拍', climax: '高潮',
  }
  card.append(element('h3', `${shotHeading(shot)}${shot.hook ? ` · ${hookLabels[shot.hook] || shot.hook}` : ''}`))
  if (shot.format === 'text') {
    card.append(element('p', shot.content || '还未生成', 'prompt full'))
    appendJsonCopy(card, shot.content)
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
  const controls = element('div', '', 'workflow-generation-row')
  controls.append(element('span', statusLabels[feedbackOf(project, 'seconds').status], 'story-status'))
  const button = element('button', '整集重新生成', 'primary')
  button.type = 'button'
  button.disabled = busy
  button.onclick = () => {
    if (button.disabled) return
    button.disabled = true
    button.textContent = '生成中'
    actions.perform(project, 'seconds', reviewFields(view)).catch(error => {
      button.disabled = false
      button.textContent = '整集重新生成'
      actions.fail(error)
    })
  }
  controls.append(button)
  view.append(controls)
  appendWorkflowReview(view, feedbackOf(project, 'seconds'), shots.some(shot => Boolean(shot.seconds.content)), busy, button)
  for (const shot of shots) {
    const card = element('article', '', 'shot-card')
    card.dataset.modelKey = `shot:${shot.id}`
    card.append(element('h3', shotHeading(shot)))
    if (shot.seconds.content) card.append(element('p', shot.seconds.content, 'prompt full'))
    appendJsonCopy(card, shot.seconds.content || { id: shot.id, duration: shot.duration, seconds: shot.seconds })
    view.append(card)
  }
}

function paintBoards(view, project, actions) {
  const shots = project.shots?.items || []
  if (!shots.length) appendWorkflowReview(view, feedbackOf(project, 'storyboard'), false)
  const tableBusy = Boolean(project.activity)
  if (hasShots(project)) {
    const boarding = project.activity === 'storyboard'
    const controls = element('div', '', 'actions')
    const button = element('button', '整集重新生成', 'primary')
    button.type = 'button'
    button.disabled = tableBusy || !canGenerate(project, 'storyboard')
    button.onclick = () => {
      if (button.disabled) return
      button.disabled = true
      button.textContent = '生成中'
      actions.perform(project, 'storyboard', { generationMode: 'regenerate' }).catch(error => {
        button.disabled = false
        button.textContent = '整集重新生成'
        actions.fail(error)
      })
    }
    controls.append(button)
    if (boarding) controls.append(element('span', '生成中'))
    view.append(controls)
  }
  for (const shot of shots) {
    const story = shotResults(project, 'storyboard').find(item => item.id === shot.id)
    const secondsReady = shotSecondsReady(shot)
    const card = element('article', '', 'shot-card')
    card.dataset.modelKey = `shot:${shot.id}`
    card.append(element('h3', shotHeading(shot)))
    if (story) field(card, '视频生成模式', videoModeLabel(story))
    if (story?.textShot) card.append(textShotView(project, story, actions))
    if (story && hasBoardPrompt(story)) {
      card.append(storyboardEditor(project, story, promptText(story.prompt), actions))
      const prompt = element('p', requestLines(project, shot, story), 'prompt full')
      card.append(prompt, storyboardReferences(project, story))
    }
    regenRow(card, {
      busy: project.activity === `shot-storyboard:${shot.id}`,
      enabled: secondsReady && !tableBusy,
      label: story ? '重新生成' : '生成',
      record: feedbackOf(project, { action: 'shot-storyboard', track: shot.id }),
      check: feedbackOf(project, { action: 'shot-storyboard', track: shot.id }).check,
      generated: Boolean(story && hasBoardPrompt(story)),
      onRun: fields => actions.perform(project, 'shot-storyboard', { track: shot.id, ...fields }),
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
    const story = shotResults(project, 'storyboard').find(item => item.id === shot.id)
    const boardReady = hasBoardPrompt(story)
    const drawing = shotMap(project, 'pencil')?.[shot.id]
    const drawingNow = activity === `pencil:${shot.id}`
    const card = element('article', '', 'shot-card')
    card.dataset.modelKey = `shot:${shot.id}`
    const head = element('div', '', 'outline-head')
    head.append(element('h3', shotHeading(shot)))
    head.append(aiButton(actions, drawingNow, boardReady && !activity, () => actions.beginImage(project, 'pencil', { track: shot.id, ...reviewFields(card) })))
    card.append(head)
    if (!boardReady) card.append(element('p', '先写好这一镜的文本分镜。', 'meta'))
    if (drawing?.url) mountPencil(card, drawing.url, `${shot.id} 铅笔分镜`)
    else card.append(element('p', drawingNow ? '正在画出这一镜的全部格子。' : '生成后整张草图会显示在这里。', 'meta'))
    appendJsonCopy(card, drawing)
    appendWorkflowReview(card, feedbackOf(project, { action: 'pencil', track: shot.id }), Boolean(drawing?.url), Boolean(project.activity), head.querySelector('button.outline-ai'))
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
  open.onclick = () => { full.src = url; showPanelDialog(preview) }
  parent.append(preview, open)
}

function renderFilm(project, actions, context) {
  const view = element('section', '', 'session-project')
  view.append(element('h3', '成片'), skillField(project, 'storyboard', actions), skillField(project, 'film', actions))
  const all = element('button', '依次生成全部成片', 'primary')
  all.disabled = Boolean(project.activity)
  bindBusy(all, () => actions.perform(project, 'produce-all'), '任务已启动')
  if (!context.onlyShot) view.append(all)
  for (const shot of project.shots.items.filter(s => !context.onlyShot || s.id === context.onlyShot)) {
    const card = element('article', '', 'shot-card')
    card.dataset.modelKey = `film:${shot.id}`
    card.append(element('h3', shotHeading(shot)))
    const storySection = element('section', '', 'film-storyboard-section')
    const storyHead = element('div', '', 'workflow-generation-row')
    storyHead.append(element('h4', `分镜提示词 · ${statusLabels[shot.storyboard.status]}`))
    const storyGenerate = element('button', shot.storyboard.content ? '重新生成提示词' : '生成提示词', 'primary')
    storyGenerate.disabled = Boolean(project.activity) || shot.seconds.check.passed !== true
    bindBusy(storyGenerate, () => actions.perform(project, 'shot-storyboard', { track: shot.id, ...reviewFields(storySection) }), '生成中')
    storyHead.append(storyGenerate)
    storySection.append(storyHead)
    card.append(storySection)
    const story = shot.storyboard.content
    if (story?.textShot) storySection.append(textShotView(project, { ...story, id: shot.id }, actions))
    if (story?.prompt) {
      storySection.append(storyboardEditor(project, { ...story, id: shot.id }, promptText(story.prompt), actions))
      storySection.append(element('p', promptText(story.prompt), 'prompt full'), storyboardReferences(project, { ...story, id: shot.id }))
      appendJsonCopy(storySection, story)
    }
    if (!story?.prompt) storySection.append(element('div', '分镜提示词尚未生成', 'storyboard-empty film-prompt-empty'))
    appendWorkflowReview(storySection, shot.storyboard, Boolean(story?.prompt), Boolean(project.activity), storyGenerate)
    storyGenerate.textContent = story?.prompt ? '重新生成提示词' : '生成提示词'
    storyGenerate.setAttribute('aria-label', storyGenerate.textContent)
    const videoReview = element('section', '', 'film-video-section')
    const media = element('div', '', 'film-media-row')
    const videoColumn = element('div', '', 'film-video-preview')
    const tailColumn = element('div', '', 'film-tail-preview')
    const clip = shot.video.content
    videoColumn.append(element('h4', `视频 · ${statusLabels[shot.video.status]}`))
    if (clip?.url) { const video = element('video'); video.controls = true; video.src = clip.url; videoColumn.append(video) }
    else videoColumn.append(element('div', '本镜视频尚未生成', 'storyboard-empty'))
    const tail = clip?.status === 'ready' && !shot.video.stale && shot.tailFrame?.content?.sourceVideoFile === clip.file ? shot.tailFrame : null
    tailColumn.append(element('h4', '尾帧'))
    if (tail?.content?.localPath) { const img = element('img'); img.src = `/plugins/meiji/projects/${project.id}/tail-frame/${project.episodeId}/${shot.id}`; img.alt = '本镜尾帧'; tailColumn.append(img) }
    else tailColumn.append(element('div', '本镜尾帧尚未生成', 'storyboard-empty'))
    if (tail?.error) tailColumn.append(element('p', tail.error, 'notice'))
    media.append(videoColumn, tailColumn)
    videoReview.append(media)
    const mediaActions = element('div', '', 'film-media-actions')
    const retry = element('button', clip?.url ? '重新生成视频' : '生成视频', 'primary')
    retry.disabled = Boolean(project.activity) || shot.storyboard.check.passed !== true
    bindBusy(retry, () => actions.perform(project, 'film', { track: shot.id, ...reviewFields(videoReview) }), '任务已启动')
    mediaActions.append(retry)
    if (clip?.status === 'ready') {
      const retryTail = element('button', tail?.content?.localPath ? '重新提取尾帧' : '提取尾帧')
      retryTail.disabled = Boolean(project.activity)
      bindBusy(retryTail, () => actions.perform(project, 'tail-frame', { track: shot.id }), '任务已启动')
      mediaActions.append(retryTail)
    }
    videoReview.append(mediaActions)
    appendWorkflowReview(videoReview, { ...shot.video, error: shot.video.error || clip?.error }, Boolean(clip?.url), Boolean(project.activity), retry)
    retry.textContent = clip?.url ? '重新生成视频' : '生成视频'
    retry.setAttribute('aria-label', retry.textContent)
    card.append(videoReview)
    decorateShotCard(card, shot.storyboard, shot.id, project.shots.items[0].id === shot.id)
    if (actions.openHistory) card.querySelector('.shot-head').append(historyEntry(project, actions, `film:${shot.id}`))
    view.append(card)
  }
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
  if (project.assembly?.stale) concatCard.append(element('p', '上游内容已更改，此合成视频为旧版本，请重新生成成片并合成。', 'notice'))
  if (project.assembly?.content?.url) {
    const video = element('video')
    video.controls = true
    video.playsInline = true
    video.src = project.assembly.content.url
    concatCard.append(video)
  }
  appendWorkflowReview(concatCard, feedbackOf(project, 'assembly'), Boolean(project.assembly?.content?.url), busy)
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
  summary: renderBrief,
  script: renderStory,
  shots: (project, actions) => renderShots(project, actions),
  seconds: (project, actions) => renderShots(project, actions, 'seconds'),
  film: renderFilm,
  assembly: renderAssembly,
}

export function renderStage(step, project, actions, context) {
  const view = (renderers[step] || renderers.script)(project, actions, context)
  const toolbar = element('div', '', 'stage-history-toolbar')
  if (actions.openHistory && step !== 'film') toolbar.append(historyEntry(project, actions, step))
  for (const field of view.querySelectorAll('.custom-skill-field')) {
    const button = field.querySelector('button')
    button.dataset.label = step === 'film' ? (button.dataset.skill === 'storyboard' ? '分镜 skill' : '成片 skill') : '查看 skill'
    button.textContent = button.dataset.label + (button.dataset.status ? ` · ${button.dataset.status}` : '')
    if (step !== 'script') { toolbar.append(button); field.remove() }
  }
  const scope = step === 'script' ? view.querySelector('.story-controls') : view
  const header = scope.querySelector(':scope > .outline-head, :scope > .workflow-generation-row')
  const controls = element('div', '', 'stage-primary-actions')
  const generate = header?.querySelector('button.primary') || (step === 'film' ? scope.querySelector(':scope > button.primary') : step === 'assembly' ? scope.querySelector(':scope > .shot-card > button.primary') : null)
  if (step === 'summary') {
    const edit = header?.querySelector('.section-actions > button:not(.primary)')
    if (edit) controls.append(edit)
  }
  if (generate) controls.append(generate)
  if (header) header.remove()
  scope.querySelector(':scope > h3')?.remove()
  const stage = { summary: 'summary', script: 'outline', shots: 'shots', seconds: 'seconds', assembly: 'assembly' }[step]
  const state = stage ? stepRunLabel(project, stage) : project.activity ? '执行中' : hasFilm(project) ? '已完成' : '未完成'
  toolbar.prepend(element('span', state, 'stage-status'))
  if (controls.childElementCount) toolbar.append(controls)
  view.prepend(toolbar)
  for (const el of view.querySelectorAll('[data-model-key]')) el.dataset.modelKey = `${project.id}:${project.episodeId}:${step}:${el.dataset.modelKey}`
  return view
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
  bar.append(back, element('h2', shotHeading(shot)))
  const nav = element('nav', '', 'stage-overview')
  nav.setAttribute('aria-label', '分镜详情')
  const body = element('div', '', 'session-body')
  const tabs = [
    ['seconds', '每秒指令'],
    ['film', '成片'],
  ]
  let active = ['seconds', 'film'].includes(context.shotTab) ? context.shotTab : 'seconds'
  const story = shotResults(project, 'storyboard').find(item => item.id === shot.id)
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
    if (active === 'film') { body.replaceChildren(renderFilm(project, actions, { ...context, onlyShot: shot.id })); return }
    const pane = element('section', '', 'session-project')
    const customStage = { seconds: 'seconds', board: 'storyboard', film: 'film' }[active]
    if (customStage) pane.append(skillField(project, customStage, actions))
    const activity = project.activity || ''
    if (active === 'seconds') {
      const head = element('div', '', 'outline-head')
      head.append(element('h3', '每秒指令'))
      head.append(element('span', '请在每秒指令卡片集顶部统一生成或修改', 'hint'))
      pane.append(head, element('p', '动作、镜头、空间、音频、交接。写满后原样进入文本分镜。', 'meta'))
      if (shot.seconds.content) pane.append(element('p', shot.seconds.content, 'prompt full'))
    } else if (active === 'board') {
      const head = element('div', '', 'outline-head')
      head.append(element('h3', '文本分镜'))
      head.append(aiButton(actions, activity === `shot-storyboard:${shot.id}`, secondsReady && !activity, () => actions.perform(project, 'shot-storyboard', { track: shot.id, ...reviewFields(pane) })))
      pane.append(head)
      if (story) {
        if (story.textShot) pane.append(textShotView(project, story, actions))
        field(pane, '标题', story.title)
        field(pane, '视频生成模式', videoModeLabel(story))
        field(pane, '场景与角色', `${story.scene || ''}｜${(story.characters || []).join('、')}`)
        field(pane, '承接', story.carryIn)
        field(pane, '交接', story.carryOut)
        for (const panel of story.panels || []) pane.append(element('p', panelLine(panel), 'prompt'))
        const prompt = element('p', promptText(story.prompt), 'prompt full')
        pane.append(storyboardEditor(project, story, promptText(story.prompt), actions), prompt, storyboardReferences(project, story))
      }
    } else if (active === 'boards') {
      const drawing = shotMap(project, 'pencil')?.[shot.id]
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
      const clip = shotMap(project, 'video')?.[shot.id]
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
    const json = active === 'seconds' ? (shot.seconds.content || { id: shot.id, duration: shot.duration, seconds: shot.seconds })
      : active === 'board' ? story : active === 'boards' ? shotMap(project, 'pencil')?.[shot.id] : shotMap(project, 'video')?.[shot.id]
    appendJsonCopy(pane, active === 'board' && story?.format === 'text' ? story.prompt.text : json)
    const target = { action: { seconds: 'shot-seconds', board: 'shot-storyboard', boards: 'pencil', film: 'film' }[active], track: shot.id }
    const generated = active === 'seconds' ? Boolean(shot.seconds.content || shot.seconds?.content) : active === 'board' ? Boolean(story && hasBoardPrompt(story)) : Boolean(json?.url)
    if (active !== 'seconds') appendWorkflowReview(pane, feedbackOf(project, target), generated, Boolean(activity), pane.querySelector('.outline-head > button.outline-ai'))
    body.replaceChildren(pane)
  }
  fragment.append(bar, nav, body)
  paint()
  return fragment
}

function videoModeLabel(story) {
  return { text: '文生视频', first_frame: '首尾帧（承接上一镜尾帧）', reference: '多模态（参考图片）' }[story.video] || '未指定，请重新生成文本分镜'
}
