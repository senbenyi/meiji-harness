import { targetBusy } from './run-activity.js'
import { secondsText } from '../shared/seconds-content.js'
import { outlineText } from '../shared/story-outline.js'
import { historyEntry } from './run-history-entry.js'
import { GenerationStatus, statusLabels } from '../shared/drama-model.js'
import { videoPromptText as promptText } from '../shared/video-prompt-text.js'
import { videoSizeOf } from '../shared/project-rules.js'
import { decorateShotCard } from './shot-card-state.js'
import { shotResults, shotMap } from '../shared/drama-model.js'
import { storyboardReferences } from './storyboard-references.js'
import { storyboardEditor } from './storyboard-editor.js'
import { skillField } from './skill-entry.js'
import { appendWorkflowReview, reviewFields } from './workflow-review.js'
import { shotReferenceImages } from '../shared/reference-images.js'
import { feedbackOf } from '../shared/review-feedback.js'
import { shotSecondsReady } from '../shared/shot-timing.js'
import { stillCards } from './asset-cards.js'
import { characterCard } from './character-views.js'
import { showPanelDialog, element, appendJsonCopy } from './panel-dom.js'
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
  edit.disabled = targetBusy(project, 'summary')
  edit.onclick = () => actions.openEpisode(project, {
    id: project.episodeId, summary: project.summary, durationSeconds: project.durationSeconds,
  })
  const regenerate = element('button', project.operationActivity === 'episode' ? '生成中' : '重新生成', 'primary')
  regenerate.disabled = targetBusy(project, 'summary')
  bindBusy(regenerate, async () => {
    try { await actions.perform(project, 'episode-generate', { episodeId: project.episodeId, ...reviewFields(view) }) }
    catch (error) { regenerate.disabled = false; regenerate.textContent = '重新生成'; actions.fail(error) }
  }, '生成中')
  const controls = element('div', '', 'section-actions')
  controls.append(edit, regenerate)
  head.append(controls)
  view.append(head, skillField(project, 'summary', actions))
  const hints = project.scriptHints || { scriptUpdated: (project.summary.basis?.scriptRevision || 0) < (project.scriptRevision || 0), pendingSync: project.summary.basis?.scriptSyncedRevision !== project.summary.revision }
  view.append(element('p', [`依据 V${project.summary.basis?.scriptRevision || 0} / 当前 V${project.scriptRevision || 0}`, hints.scriptUpdated && '剧本已更新', hints.previousModified && '前集已修改', hints.pendingSync && '待回写', project.pendingScriptProposal && '待确认方案'].filter(Boolean).join(' · '), 'meta'))
  const current = element('button', '按当前剧本重新生成'), process = element('button', '处理方案'), revert = element('button', '把本集改回符合剧本')
  current.disabled = revert.disabled = targetBusy(project, 'summary')
  current.onclick = () => actions.perform(project, 'summary', { episodeId: project.episodeId }).catch(actions.fail)
  revert.onclick = () => actions.perform(project, 'summary', { episodeId: project.episodeId, requirements: '将本集改回符合当前剧本' }).catch(actions.fail)
  process.onclick = () => actions.openScript?.(project)
  controls.append(current, process, revert)
  if (project.summary.content) view.append(element('p', project.summary.content, 'summary'))
  appendWorkflowReview(view, feedbackOf(project, 'summary'), Boolean(project.summary.content), targetBusy(project, 'summary'), regenerate, { allowFailureOpinion: true })
  return view
}

function storyNodeActions(project, actions, stage) {
  const row = element('div', '', 'story-node-actions')
  if (actions.openHistory) row.append(historyEntry(project, actions, stage))
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
    view.append(element('pre', outlineText(project.plot.outline.content), 'story'))
    appendJsonCopy(view, project.plot.outline.content)
    const summary = element('div', '', 'display-summary')
    summary.append(element('h4', '本集摘要（仅展示）'), element('p', project.summary?.outlineRevision === project.plot.outline.revision && project.summary?.content ? project.summary.content : project.summary?.error ? '摘要提取失败，故事小段与后续制作不受影响。' : '等待从故事小段提取摘要。'))
    if (project.summary?.error && project.plot.outline.check?.passed === true) {
      const retry = element('button', '重新提取摘要'); retry.disabled = targetBusy(project, 'summary')
      retry.onclick = () => actions.perform(project, 'summary', { mode: 'regenerate' }).catch(actions.fail)
      summary.append(retry)
    }
    view.append(summary)
  }
  return view
}

function renderStory(project, actions, context) {
  const controls = element('section', '', 'session-project story-controls')
  const head = element('div', '', 'outline-head')
  head.append(element('h3', '剧情生成与审核'))
  const generated = hasOutline(project)
  const label = generated ? '重新生成' : 'AI生成'
  const generate = element('button', project.operationActivity === 'outline' ? '生成中' : label, 'primary')
  generate.disabled = targetBusy(project, 'outline') || !canGenerate(project, 'outline')
  bindBusy(generate, async () => {
    try { await actions.perform(project, 'outline', reviewFields(controls)) }
    catch (error) { generate.disabled = false; generate.textContent = label; actions.fail(error) }
  }, '生成中')
  head.append(generate)
  controls.append(head, element('p', '直接生成并审核编号故事小段，通过后提取摘要用于展示。人物角色与候选图请到「本集资产」点击生成。下方意见用于本次大纲修改。', 'meta'))
  const review = appendWorkflowReview(controls, feedbackOf(project, 'outline'), generated, targetBusy(project, 'outline'), generate, { allowFailureOpinion: true })
  const input = review.querySelector('input')
  if (input) input.placeholder = '填写故事大纲的修改意见'
  generate.textContent = project.operationActivity === 'outline' ? '生成中' : label
  generate.setAttribute('aria-label', label)
  return stack([controls, renderOutline(project, actions)])
}

// 本集资产独立提取、审核人物并补图，剧情页只生成大纲。
function renderAssets(project, actions, context) {
  return stack([renderCharacters(project, actions, context)])
}

function charactersFeedback(project) {
  const record = feedbackOf(project, 'characters')
  const error = record.error || (record.check?.passed !== true ? project.charactersFailure : '')
  return { ...record, ...(error ? { status: GenerationStatus.FAILED, error } : {}),
    ...(/^生成结果格式无效，无法保存：/.test(error || '') ? { canModify: true } : {}) }
}

function renderCharacters(project, actions, context) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  const title = element('div', '', 'asset-stage-title')
  const record = charactersFeedback(project)
  title.append(element('h3', '角色卡'), element('span', statusLabels[record.status] || stepRunLabel(project, 'characters'), 'story-status'))
  const failed = record.check?.passed === false || Boolean(record.error)
  const label = hasCharacters(project) || failed ? '重新生成人物角色' : '生成人物角色'
  const busy = targetBusy(project, 'characters')
  const generate = element('button', busy ? '生成中' : label, 'primary')
  generate.disabled = busy || !canGenerate(project, 'characters')
  bindBusy(generate, async () => {
    try { await actions.perform(project, 'characters', reviewFields(view)) }
    catch (error) { generate.disabled = !canGenerate(project, 'characters'); generate.textContent = label; actions.fail(error) }
  }, '生成中')
  const controls = storyNodeActions(project, actions, 'characters')
  controls.append(generate)
  head.append(title, controls)
  view.append(head)
  const hint = element('p', hasCharacters(project) ? '' : gateMessage(project, 'characters'), 'hint')
  hint.hidden = !hint.textContent
  view.append(hint)
  const review = appendWorkflowReview(view, record, hasCharacters(project), busy, generate, { allowFailureOpinion: true })
  const input = review.querySelector('input')
  if (input) input.placeholder = '填写人物角色的修改意见'
  generate.textContent = busy ? '生成中' : label
  generate.setAttribute('aria-label', label)
  const cards = element('div', '', 'character-list')
  for (const item of project.plot.characters?.items || []) cards.append(characterCard(project, item, actions, context))
  view.append(cards)
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
  if (item && actions.openHistory) head.append(historyEntry(project, actions, `scenes,image:${item.id}`))
  page.append(head)
  if (!item) {
    page.append(element('p', '该场景已不存在，请返回列表重新选择。', 'notice'))
    return page
  }
  page.append(element('p', '场景资料与形象管理', 'meta'))
  // 错误显示在对应内容与图片节点上；这里只承载本页的即时提示。
  const hint = element('p', '', 'hint warn')
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
  for (const node of stillCards(project, project.plot.scenes?.items || [], actions, hint, { imageGate: context.imageGate, onOpen: id => context.onOpenScene?.(project.episodeId, id) })) (node.tagName === 'DIALOG' || node.tagName === 'INPUT' ? view : list).append(node)
  view.append(list)
  if (!hasScenes(project)) view.append(element('p', '未生成：在「剧情」页生成剧情，依次完成大纲、人物提取和场景提取，并自动生成角色和场景候选图。', 'meta'))
  return view
}

// 道具不由 AI 提取；保留已有道具卡的素材维护能力，缺失时按空集合处理。
function renderProps(project, actions) {
  const view = element('section', '', 'session-project')
  const head = element('div', '', 'outline-head')
  head.append(element('h3', '道具'))
  view.append(head)
  const hint = element('p', '', 'hint'); hint.hidden = true
  view.append(hint)
  const items = project.plot.props?.items || []
  if (items.length) view.append(...stillCards(project, items, actions, hint, { editable: true }))
  else view.append(element('p', '本集暂无道具。', 'meta'))
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
    const shot = project.shots.items.find(item => card.dataset.modelKey === `shot:${item.id}`)
    const model = stage === 'shots' ? (shot.check.passed === null ? project.shots : shot) : shot.seconds
    decorateShotCard(card, model, shot.id, index === 0)
  })
  return view
}

function paintShotTable(view, project, actions) {
  const heading = element('div', '', 'workflow-generation-row')
  heading.append(element('span', stepRunLabel(project, 'shots'), 'story-status'))
  view.append(heading)
  const tableBusy = targetBusy(project, 'shots')
  const ready = canGenerate(project, 'shots')
  const hasTable = hasShots(project)
  const label = hasTable || Boolean(project.shots?.failedOutput) ? '重新生成' : 'AI生成'
  const button = element('button', project.operationActivity === 'shots' ? '生成中' : label, 'primary')
  button.type = 'button'
  button.disabled = tableBusy || !ready
  if (!ready) button.title = gateMessage(project, 'shots')
  bindBusy(button, () => actions.perform(project, 'shots', reviewFields(view)), '生成中')
  heading.append(button)
  if (!ready) view.append(element('p', button.title, 'notice shot-generation-blocker'))
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
  const busy = targetBusy(project, 'seconds:*')
  const controls = element('div', '', 'workflow-generation-row')
  controls.append(element('span', statusLabels[feedbackOf(project, 'seconds').status], 'story-status'))
  const label = shots.some(shot => Boolean(shot.seconds.content)) ? '重新生成' : 'AI生成'
  const button = element('button', label, 'primary')
  button.type = 'button'
  button.disabled = busy || !shots.length
  button.onclick = () => {
    if (button.disabled) return
    button.disabled = true
    button.textContent = '生成中'
    actions.perform(project, 'seconds', reviewFields(view)).catch(error => {
      button.disabled = false
      button.textContent = label
      actions.fail(error)
    })
  }
  controls.append(button)
  view.append(controls)
  appendWorkflowReview(view, feedbackOf(project, 'seconds'), shots.some(shot => Boolean(shot.seconds.content)), busy, button, { allowFailureOpinion: true })
  const generatedShots = shots.filter(shot => Boolean(shot.seconds.content || shot.seconds.archivedContent))
  if (!generatedShots.length) view.append(element('p', shots.length ? '暂无每秒指令，点击 AI生成。' : '暂无每秒指令，请先生成镜头表。', 'meta'))
  for (const shot of generatedShots) {
    const card = element('article', '', 'shot-card')
    card.dataset.modelKey = `shot:${shot.id}`
    card.append(element('h3', shotHeading(shot)))
    if (shot.seconds.content) card.append(element('p', secondsText(shot.seconds.content), 'prompt full'))
    if (shot.seconds.content && shot.seconds.check?.passed === false) card.append(element('p', `本镜自审未通过：${(shot.seconds.check.failures || []).join('；')}`, 'hint warn'))
    if (shot.seconds.archivedContent) { const archive = element('details'); archive.append(element('summary', '查看迁移前的每秒指令（只读）'), element('pre', String(shot.seconds.archivedContent), 'prompt full')); card.append(archive) }
    appendJsonCopy(card, shot.seconds.content || { id: shot.id, duration: shot.duration, seconds: shot.seconds })
    view.append(card)
  }
}

function paintBoards(view, project, actions) {
  const shots = project.shots?.items || []
  if (!shots.length) appendWorkflowReview(view, feedbackOf(project, 'storyboard'), false)
  const tableBusy = targetBusy(project, 'storyboard:*')
  if (hasShots(project)) {
    const boarding = project.operationActivity === 'storyboard'
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
    if (story && hasBoardPrompt(story)) {
      card.append(storyboardEditor(project, story, promptText(story.prompt), actions))
      const prompt = element('p', requestLines(project, shot, story), 'prompt full')
      card.append(prompt, storyboardReferences(project, story))
    }
    regenRow(card, {
      busy: project.operationActivity === `shot-storyboard:${shot.id}`,
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

function renderFilm(project, actions, context) {
  const view = element('section', '', 'session-project')
  view.append(element('h3', '成片'), skillField(project, 'storyboard', actions), skillField(project, 'film', actions))
  const selected = project.shots.items.filter(shot => !context.onlyShot || shot.id === context.onlyShot)
  const generated = selected.some(shot => Boolean(shot.video.content?.url || shot.video.content?.file))
  const all = element('button', generated ? '重新生成' : 'AI生成', 'primary')
  all.disabled = !selected.length || targetBusy(project, 'film:*') || targetBusy(project, 'storyboard:*')
  bindBusy(all, () => actions.perform(project, context.onlyShot ? 'produce' : 'produce-all', { generationMode: generated ? 'regenerate' : 'generate', ...(context.onlyShot ? { track: context.onlyShot } : {}) }), '任务已启动')
  if (!context.onlyShot || !generated) view.append(all)
  if (!selected.length) view.append(element('p', '暂无镜头，请先生成镜头表。', 'meta'))
  for (const shot of selected) {
    const card = element('article', '', 'shot-card')
    card.dataset.modelKey = `film:${shot.id}`
    card.append(element('h3', shotHeading(shot)))
    const storySection = element('section', '', 'film-storyboard-section')
    const storyHead = element('div', '', 'workflow-generation-row')
    storyHead.append(element('h4', `分镜提示词 · ${statusLabels[shot.storyboard.status]}`))
    const storyGenerate = element('button', shot.storyboard.content ? '重新生成提示词' : '生成提示词', 'primary')
    storyGenerate.disabled = targetBusy(project, `storyboard:${shot.id}`) || shot.seconds.check.passed !== true
    bindBusy(storyGenerate, () => actions.perform(project, 'shot-storyboard', { track: shot.id, ...reviewFields(storySection) }), '生成中')
    storyHead.append(storyGenerate)
    storySection.append(storyHead)
    card.append(storySection)
    const story = shot.storyboard.content
    if (story?.prompt) {
      storySection.append(storyboardEditor(project, { ...story, id: shot.id }, promptText(story.prompt), actions))
      storySection.append(element('p', promptText(story.prompt), 'prompt full'), storyboardReferences(project, { ...story, id: shot.id }))
      appendJsonCopy(storySection, story)
    }
    if (!story?.prompt) storySection.append(element('div', '分镜提示词尚未生成', 'storyboard-empty film-prompt-empty'))
    appendWorkflowReview(storySection, shot.storyboard, Boolean(story?.prompt), targetBusy(project, `storyboard:${shot.id}`), storyGenerate)
    storyGenerate.textContent = story?.prompt ? '重新生成' : 'AI生成'
    storyGenerate.setAttribute('aria-label', storyGenerate.textContent)
    const videoReview = element('section', '', 'film-video-section')
    const media = element('div', '', 'film-media-row')
    const videoColumn = element('div', '', 'film-video-preview')
    const tailColumn = element('div', '', 'film-tail-preview')
    const clip = shot.video.content
    videoColumn.append(element('h4', `视频 · ${statusLabels[shot.video.status]}`))
    if (clip?.url) { const video = element('video'); video.controls = true; video.src = clip.url; videoColumn.append(video) }
    else videoColumn.append(element('div', '本镜视频尚未生成', 'storyboard-empty'))
    const tail = clip?.status === 'ready' && shot.tailFrame?.content?.sourceVideoFile === clip.file ? shot.tailFrame : null
    tailColumn.append(element('h4', '尾帧'))
    if (tail?.content?.localPath) { const img = element('img'); img.src = `/plugins/meiji/projects/${project.id}/tail-frame/${project.episodeId}/${shot.id}`; img.alt = '本镜尾帧'; tailColumn.append(img) }
    else tailColumn.append(element('div', '本镜尾帧尚未生成', 'storyboard-empty'))
    if (tail?.error) tailColumn.append(element('p', tail.error, 'notice'))
    media.append(videoColumn, tailColumn)
    videoReview.append(media)
    const mediaActions = element('div', '', 'film-media-actions')
    const retry = element('button', clip?.url ? '重新生成视频' : '生成视频', 'primary')
    retry.disabled = targetBusy(project, `film:${shot.id}`) || shot.storyboard.check.passed !== true
    bindBusy(retry, () => actions.perform(project, 'film', { track: shot.id, ...reviewFields(videoReview) }), '任务已启动')
    mediaActions.append(retry)
    if (clip?.status === 'ready') {
      const retryTail = element('button', tail?.content?.localPath ? '重新提取尾帧' : '提取尾帧')
      retryTail.disabled = targetBusy(project, `film:${shot.id}`)
      bindBusy(retryTail, () => actions.perform(project, 'tail-frame', { track: shot.id }), '任务已启动')
      mediaActions.append(retryTail)
    }
    videoReview.append(mediaActions)
    appendWorkflowReview(videoReview, { ...shot.video, error: shot.video.error || clip?.error }, Boolean(clip?.url), targetBusy(project, `film:${shot.id}`), retry)
    retry.textContent = clip?.url ? '重新生成' : 'AI生成'
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
  const busy = project.operationActivity === 'assemble'
  const button = element('button', busy ? '拼接中' : '全片拼接', 'primary')
  button.type = 'button'
  button.disabled = targetBusy(project, 'assembly') || !hasFilm(project)
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
  script: renderStory,
  assets: renderAssets,
  shots: (project, actions) => renderShots(project, actions),
  seconds: (project, actions) => renderShots(project, actions, 'seconds'),
  film: renderFilm,
  assembly: renderAssembly,
}

export function renderStage(step, project, actions, context) {
  const view = (renderers[step] || renderers.script)(project, actions, context)
  const toolbar = element('div', '', 'stage-history-toolbar')
  if (actions.openHistory) toolbar.append(historyEntry(project, actions, step))
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
  const state = step === 'assets' ? statusLabels[charactersFeedback(project).status] || stepRunLabel(project, 'characters') : stage ? stepRunLabel(project, stage) : project.operationActivity ? '执行中' : hasFilm(project) ? '已完成' : '未完成'
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
    if (actions.openHistory) pane.append(historyEntry(project, actions, `seconds:${shot.id}`))
    const activity = project.operationActivity || ''
    if (active === 'seconds') {
      const head = element('div', '', 'outline-head')
      head.append(element('h3', '每秒指令'))
      head.append(element('span', '请在每秒指令卡片集顶部统一生成或修改', 'hint'))
      pane.append(head, element('p', '动作、镜头、空间、音频、交接。写满后原样进入文本分镜。', 'meta'))
      if (shot.seconds.content) pane.append(element('p', secondsText(shot.seconds.content), 'prompt full'))
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
        const prompt = element('p', promptText(story.prompt), 'prompt full')
        pane.append(storyboardEditor(project, story, promptText(story.prompt), actions), prompt, storyboardReferences(project, story))
      }
    } else {
      const clip = shotMap(project, 'video')?.[shot.id]
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
      : active === 'board' ? story : shotMap(project, 'video')?.[shot.id]
    appendJsonCopy(pane, active === 'board' && story?.format === 'text' ? story.prompt.text : json)
    const target = { action: { seconds: 'shot-seconds', board: 'shot-storyboard', film: 'film' }[active], track: shot.id }
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
