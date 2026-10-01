// 「任务历史」页：已记录的任务（按状态筛选），每个任务的步骤清单与「当前任务」页共用 task-steps.js。
import { element } from './dom.js'
import { renderSteps, taskStatusLabels } from './task-steps.js'
const names = { 'episode-generate': '生成摘要', 'episode-add': '新增摘要', 'episode-edit': '编辑摘要', outline: '生成剧情', 'outline-text': '编辑剧情', characters: '修改角色', scenes: '修改场景', 'scene-text': '编辑场景', 'character-text': '编辑人物文字', shots: '生成镜头表', 'revise-shot': '修改镜头表', seconds: '生成每秒指令', storyboard: '生成文本提示词', 'shot-storyboard': '生成文本提示词', 'shot-boards': '生成文本提示词', 'storyboard-text': '编辑文本提示词', film: '生成成片', films: '生成成片', produce: '生成本镜文本和视频', 'produce-all': '依次生成文本和视频', assemble: '合成视频', 'tail-frame': '重新处理尾帧', 'shot-assets': '修改镜头素材', source: '编辑资料', overview: '保存项目概要',
  'text-shot-edit': '编辑文本镜头', 'storyboard-bind': '编排多模态引用',
  image: '生成图片', 'revise-image': '重绘图片', 'part-image': '生成图片', pencil: '生成铅笔分镜', 'import-image': '导入图片', 'part-import': '导入图片', 'part-text': '编辑图片描述', 'set-reference': '设置参考图', 'clear-reference': '移除参考图', 'use-asset': '关联图片素材', 'clear-image': '删除图片', 'confirm-image': '确认使用图片', 'discard-image': '放弃候选图片', 'review-override': '忽略自审并通过' }
const targets = { summary: '摘要', story: '剧情', shots: '镜头表', seconds: '每秒指令', storyboard: '文本提示词', film: '成片', assembly: '合成视频' }
const time = value => value ? new Date(value).toLocaleString() : '—'
const skillNames = { episode: '剧集摘要', outline: '剧情整包', shots: '镜头表', 'shot-revise': '单镜修订', seconds: '每秒指令', storyboard: '文本分镜', video: '成片', 'image-prompt': '图片提示词改写', 'character-image': '人物参考图', 'scene-image': '场景参考图', 'part-image': '附属素材图', pencil: '铅笔分镜',
  'guidance-action': '动作指导', 'guidance-martial': '武术指导', 'guidance-dialogue': '台词指导', 'guidance-expression': '表情指导', 'guidance-sound': '声音指导' }

// 任务所用技能：任务开始时固定的组合，标明是否为修改后的基础版本、是否含本剧补充。
export function skillsLine(skills = []) {
  if (!skills.length) return null
  const text = skills.map(skill => {
    const notes = [skill.layers.includes('base') ? '基础已修改' : '', skill.layers.includes('node') ? '含本节点补充' : skill.layers.includes('project') ? '含本剧补充' : ''].filter(Boolean)
    return `${skillNames[skill.id] || skill.id}${skill.nodeKey ? ` · ${skill.nodeKey}` : ""}${notes.length ? `（${notes.join('、')}）` : ''}`
  }).join('、')
  const line = element('p', `所用技能：${text}`, 'meta task-skills')
  line.title = skills.map(skill => `${skill.id} ${skill.hash}`).join('\n')
  return line
}

const scopes = { images: ['图片', ['image', 'revise-image', 'part-image', 'import-image', 'part-import', 'part-text', 'set-reference', 'clear-reference', 'use-asset', 'clear-image', 'confirm-image', 'discard-image']], outline: ['大纲', ['outline', 'outline-text']], characters: ['人物角色', ['outline', 'characters', 'character-text']], scenes: ['场景', ['outline', 'scenes', 'scene-text']], summary: ['摘要', ['episode-summary-draft', 'episode-generate', 'episode-add', 'episode-edit']], script: ['剧情', ['outline', 'outline-text', 'characters', 'scenes', 'scene-text', 'character-text']], shots: ['镜头表', ['shots', 'revise-shot', 'shot-assets']], seconds: ['每秒指令', ['seconds', 'shot-seconds']], film: ['成片', ['storyboard', 'shot-storyboard', 'shot-boards', 'storyboard-text', 'text-shot-edit', 'storyboard-bind', 'film', 'films', 'produce', 'produce-all', 'tail-frame']], assembly: ['合成', ['assemble']] }

export function historyEntry(project, actions, scope = '') {
  const scopeKey = scope.split(':')[0]
  const button = element('button', scopes[scopeKey] ? `查看${scopes[scopeKey][0]}任务历史 →` : project.episodeId ? '查看本集任务历史 →' : '查看项目任务历史 →', 'task-history-entry')
  button.type = 'button'
  button.onclick = () => actions.openHistory(project, scope)
  return button
}

export function renderTaskHistory(project, { load, loadPrompts, back, historyScope = '' }) {
  const [scopeKey, track] = historyScope.split(':')
  const shotId = scopeKey === 'film' ? track : null
  const matchesShot = item => !shotId || item.target?.split(':')[1] === shotId
  const view = element('section', '', 'task-history-page')
  const header = element('div', '', 'task-history-header')
  const backButton = element('button', '← 返回')
  backButton.type = 'button'
  backButton.onclick = back
  const refresh = element('button', '刷新')
  refresh.type = 'button'
  refresh.type = 'button'
  header.append(backButton, element('h2', scopes[scopeKey] ? `${shotId ? `${shotId} · ` : ''}${scopes[scopeKey][0]}任务历史` : '任务历史'), refresh)
  const scope = project.episodeId ? project.episodeNumber ? `第 ${project.episodeNumber} 集` : '本集' : '全部剧集'
  const filter = element('select')
  filter.setAttribute('aria-label', '按任务状态筛选')
  for (const [value, label] of [['', '全部状态'], ...['queued', 'running', 'completed', 'review_failed', 'failed', 'cancelled'].map(value => [value, taskStatusLabels[value]])]) {
    const option = element('option', label); option.value = value; filter.append(option)
  }
  const toolbar = element('div', '', 'task-history-toolbar')
  const count = element('span', '', 'meta')
  toolbar.append(filter, count)
  const message = element('p', '', 'meta')
  message.setAttribute('role', 'status')
  const list = element('div', '', 'task-history-list')
  view.append(header, element('p', `${project.title || '项目'} · ${scope}`, 'meta'), toolbar, message, list)
  let tasks = [], requestId = 0
  const draw = () => {
    const expanded = new Set([...list.querySelectorAll('details[data-task-id][open]')].map(item => item.dataset.taskId))
    list.replaceChildren()
    const selected = tasks.filter(task => !filter.value || task.status === filter.value)
    count.textContent = `${selected.length} 条任务`
    message.textContent = selected.length ? '' : tasks.length ? '没有符合条件的任务' : '暂无任务历史'
    for (const task of selected) {
      const item = element('details', '', 'task-history-item')
      item.dataset.taskId = task.id
      item.open = expanded.has(task.id)
      const row = element('summary', '', 'task-history-row')
      row.append(element('strong', names[task.action] || task.action), element('span', taskStatusLabels[task.status] || task.status, `task-history-status is-${task.status}`), element('span', task.actor === 'human' ? '人工操作' : '模型任务', 'meta'), element('span', time(task.startedAt), 'meta'))
      item.append(row)
      const detail = element('div', '', 'task-history-detail')
      detail.append(element('p', `任务编号：${task.id}`, 'meta'))
      if (!project.episodeId && task.episodeId) {
        const index = [...(project.episodes || [])].reverse().findIndex(episode => episode.id === task.episodeId)
        detail.append(element('p', index >= 0 ? `第 ${index + 1} 集` : `剧集：${task.episodeId}`, 'meta'))
      }
      detail.append(element('p', `开始：${time(task.startedAt)}　结束：${time(task.endedAt)}`, 'meta'))
      if (task.requirements) detail.append(element('p', `生成要求：${task.requirements}`))
      if (task.opinion) detail.append(element('p', `修改意见：${task.opinion}`))
      if (task.error) detail.append(element('p', task.error, 'error'))
      const used = skillsLine(task.skills)
      if (used) detail.append(used)
      detail.append(renderSteps((task.steps || []).filter(matchesShot), { live: ['queued', 'running'].includes(task.status), loadPrompts: loadPrompts && (step => loadPrompts(task, step)) }))
      for (const artifact of (task.artifacts || []).filter(matchesShot)) {
        const [kind, track] = artifact.target.split(':')
        const snapshot = element('details', '', 'task-history-snapshot')
        snapshot.append(element('summary', `${targets[kind] || kind}${track ? ` · ${track}` : ''} · V${artifact.version} · 内容快照`))
        const content = element('pre')
        snapshot.append(content)
        let loaded = false, loading = false
        snapshot.ontoggle = async () => {
          if (!snapshot.open || loaded || loading) return
          loading = true; content.textContent = '加载中…'
          try {
            const result = await load(artifact.artifactId)
            content.textContent = typeof result.artifact.content === 'string' ? result.artifact.content : JSON.stringify(result.artifact.content, null, 2)
            loaded = true
          } catch (error) { content.textContent = `加载失败：${error.message}。收起后重新展开可重试。` }
          finally { loading = false }
        }
        detail.append(snapshot)
      }
      item.append(detail)
      list.append(item)
    }
  }
  filter.onchange = draw
  refresh.onclick = async () => {
    const id = ++requestId
    refresh.disabled = true; message.textContent = '加载中…'
    try {
      const result = await load()
      if (id !== requestId) return
      tasks = result.tasks.filter(task => (!scopes[scopeKey] || scopes[scopeKey][1].includes(task.action)) && (!shotId || [...(task.steps || []), ...(task.artifacts || [])].some(matchesShot)))
      draw()
    } catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
    finally { if (id === requestId) refresh.disabled = false }
  }
  view.refresh = refresh.onclick
  void view.refresh()
  return view
}
