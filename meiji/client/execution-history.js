// 「任务历史」页：已记录的任务（按状态筛选），每个任务的步骤清单与「当前任务」页共用 task-steps.js。
import { element } from './dom.js'
import { renderSteps, taskStatusLabels } from './task-steps.js'
const names = { 'episode-generate': '生成摘要', 'episode-add': '新增摘要', 'episode-edit': '编辑摘要', outline: '生成剧情', 'outline-text': '编辑剧情', characters: '修改角色', scenes: '修改场景', 'scene-text': '编辑场景', shots: '生成镜头表', 'revise-shot': '修改镜头表', seconds: '生成每秒指令', storyboard: '生成文本提示词', 'shot-storyboard': '生成文本提示词', 'shot-boards': '生成文本提示词', 'storyboard-text': '编辑文本提示词', film: '生成成片', films: '生成成片', produce: '生成本镜文本和视频', 'produce-all': '依次生成文本和视频', assemble: '合成视频', 'tail-frame': '重新处理尾帧', 'shot-assets': '修改镜头素材', source: '编辑资料', overview: '保存项目概要',
  image: '生成图片', 'revise-image': '重绘图片', 'part-image': '生成图片', pencil: '生成铅笔分镜', 'import-image': '导入图片', 'part-import': '导入图片', 'use-asset': '关联图片素材', 'clear-image': '删除图片', 'confirm-image': '确认使用图片', 'discard-image': '放弃候选图片', 'review-override': '忽略自审并通过' }
const targets = { summary: '摘要', story: '剧情', shots: '镜头表', seconds: '每秒指令', storyboard: '文本提示词', film: '成片', assembly: '合成视频' }
const time = value => value ? new Date(value).toLocaleString() : '—'

const scopes = { summary: ['摘要', ['episode-generate', 'episode-add', 'episode-edit']], script: ['剧情', ['outline', 'outline-text', 'characters', 'scenes', 'scene-text']], shots: ['镜头表', ['shots', 'revise-shot', 'shot-assets']], seconds: ['每秒指令', ['seconds', 'shot-seconds']], film: ['成片', ['storyboard', 'shot-storyboard', 'shot-boards', 'storyboard-text', 'film', 'films', 'produce', 'produce-all', 'tail-frame']], assembly: ['合成', ['assemble']] }

export function historyEntry(project, actions, scope = '') {
  const button = element('button', scopes[scope] ? `查看${scopes[scope][0]}任务历史 →` : project.episodeId ? '查看本集任务历史 →' : '查看项目任务历史 →', 'task-history-entry')
  button.type = 'button'
  button.onclick = () => actions.openHistory(project, scope)
  return button
}

export function renderTaskHistory(project, { load, back, historyScope = '' }) {
  const view = element('section', '', 'task-history-page')
  const header = element('div', '', 'task-history-header')
  const backButton = element('button', '← 返回')
  backButton.type = 'button'
  backButton.onclick = back
  const refresh = element('button', '刷新')
  refresh.type = 'button'
  header.append(backButton, element('h2', scopes[historyScope] ? `${scopes[historyScope][0]}任务历史` : '任务历史'), refresh)
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
    list.replaceChildren()
    const selected = tasks.filter(task => !filter.value || task.status === filter.value)
    count.textContent = `${selected.length} 条任务`
    message.textContent = selected.length ? '' : tasks.length ? '没有符合条件的任务' : '暂无任务历史'
    for (const task of selected) {
      const item = element('details', '', 'task-history-item')
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
      detail.append(renderSteps(task.steps))
      for (const artifact of task.artifacts) {
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
      tasks = scopes[historyScope] ? result.tasks.filter(task => scopes[historyScope][1].includes(task.action)) : result.tasks
      draw()
    } catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
    finally { if (id === requestId) refresh.disabled = false }
  }
  void refresh.onclick()
  return view
}
