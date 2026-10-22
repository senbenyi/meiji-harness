import { element } from './panel-dom.js'
import { backHeader } from './project-node.js'

const stages = [
  ['story_segments', '故事大纲', 'segments'],
  ['character_extraction', '角色', 'characters'],
  ['scene_extraction', '场景', 'scenes'],
  ['shot_design', '分镜', 'shots'],
  ['video_prompt', '提示词', 'items'],
  ['videos', '成片'],
  ['episodes', '分集'],
]
const statusLabels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
// 字段标签与readable布局复制自meiji/client/content-forms.js，按drama节点契约补齐。
const fieldLabels = {
  name: '名称', title: '标题', body: '正文', description: '描述',
  world_background: '世界背景', key_anchors: '关键锚点', content: '内容', expression: '视听表达',
  characters_and_groups: '参与人物与群体', scene_and_space: '场景与空间', emotion_and_rhythm: '情绪与节奏',
  duration_seconds: '预估时长（秒）', continuity: '衔接', opening: '开场', ending: '结尾',
  social_role: '身份', age_range: '年龄段', nationality: '国籍或族群', gender: '性别', era: '年代',
  height: '身高', body_type: '体型', facial_features: '面部特征', hairstyle: '发型', voice: '声线',
  relationships: '人物关系', signature_props: '标志性道具', immutable_traits: '不可改特征', costumes: '服装',
  layout: '固定布局', materials: '材质与色彩', lighting: '基础光照', entrances_and_routes: '出入口与路线', fixed_landmarks: '固定地标',
  previous_shot_connection: '前镜衔接', story_segment_id: '故事段', key_anchor_ids: '关键锚点', scene: '场景',
  scene_id: '场景 ID', state: '开场状态', spatial_setup: '空间关系', characters: '角色', character_id: '角色 ID',
  costume_id: '服装 ID', presence: '在场状态', position: '站位', facing: '朝向', gaze_target: '目光对象',
  beats: '节拍', action: '动作', camera: '摄影', scene_changes: '环境变化', effects: '特效', audio: '声音',
  clip_id: '分片 ID', clip_ids: '分片顺序', mode: '生成方式', sources: '来源镜头', shot_id: '镜头 ID', start_beat: '起始节拍', end_beat: '结束节拍',
  text_to_video: '文生视频', multimodal: '多模态', first_last_frame: '首尾帧', prompt: '提示词',
  integrated_multimodal_description: '完整视听描述', overall_soundscape: '整体声音', non_diegetic_music: '配乐',
  subject_definitions: '参考主体', summary: '摘要', retention_analysis: '素材保留特征', detailed_description: '详细视听描述', instruction: '首尾帧说明',
  address: '视频地址', server_address: '服务端地址', actual_duration_seconds: '实际时长（秒）', keyframes: '关键帧',
}
function readable(value) {
  if (Array.isArray(value)) return value.map((item, i) => `${i + 1}. ${readable(item)}`).join('\n\n')
  if (value && typeof value === 'object') return Object.entries(value)
    .filter(([key, v]) => !['id', 'node_state'].includes(key) && v !== '' && v != null && (!Array.isArray(v) || v.length))
    .map(([key, v]) => `${fieldLabels[key] || key}：${readable(v)}`).join('\n')
  return String(value ?? '')
}

// 复制meiji/client/panel-dom.js tabs与project-ui.js stageTabs，再增加键盘与窄屏支持。
function stageTabs(entries, selected, onChange, panelId) {
  const row = element('div', '', 'stage-overview')
  row.setAttribute('role', 'tablist'); row.setAttribute('aria-label', '项目制作阶段')
  const select = key => {
    onChange(key)
    const active = row.querySelector('[aria-selected="true"]')
    active.focus(); active.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
  for (const [key, title] of entries) {
    const button = element('button', title, 'stage')
    button.type = 'button'; button.id = `${panelId}-${key}`
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panelId)
    button.setAttribute('aria-selected', String(key === selected)); button.tabIndex = key === selected ? 0 : -1
    if (key === selected) button.setAttribute('aria-current', 'step')
    button.onclick = () => select(key)
    button.onkeydown = event => {
      const index = entries.findIndex(([id]) => id === key)
      const target = { ArrowRight: (index + 1) % entries.length, ArrowLeft: (index + entries.length - 1) % entries.length, Home: 0, End: entries.length - 1 }[event.key]
      if (target === undefined) return
      event.preventDefault(); select(entries[target][0])
    }
    row.append(button)
  }
  return row
}

export function renderProjectProduction(root, project, { state, onBack, openTasks, openRules, saveOpinion }) {
  root.classList.add('project-production')
  backHeader(root, project.basic_info.name, '返回项目详情', onBack)
  if (!stages.some(([key]) => key === state.productionTab)) state.productionTab = stages[0][0]
  const panelId = `production-${project.basic_info.id}`, body = element('div', '', 'session-body')
  body.id = panelId; body.setAttribute('role', 'tabpanel')
  const nav = stageTabs(stages, state.productionTab, key => {
    state.productionTab = key
    paint()
  }, panelId)
  root.append(nav, body)
  function cards(title, rows, node, nodeType) {
    const section = element('section', '', 'production-section'), head = element('div', '', 'section-head')
    head.append(element('h3', title), element('span', rows.length ? `${rows.length} 项` : statusLabels[node?.node_state?.status] || '未生成', 'production-count'))
    section.dataset.nodeType = nodeType
    section.append(head)
    const ai = node?.node_state?.type === 1
    section.classList.add('script-node')
    section.dataset.status = node?.node_state?.status || 'empty'
    const tag = element('span', statusLabels[node?.node_state?.status] || '未生成', 'node-data-tag')
    head.querySelector('h3').after(tag)
    if (!rows.length) head.querySelector('.production-count').remove()
    const ui = element('div', '', 'node-ui'), buttons = element('div', '', 'node-ui-buttons')
    const records = element('nav', '', 'node-ui-records'), execution = element('div', '', 'node-ui-execution')
    records.setAttribute('aria-label', `${title}记录与规则`)
    const button = (label, callback) => {
      const control = element('button', label); control.type = 'button'; control.disabled = !callback; control.onclick = callback
      return control
    }
    records.append(button('任务历史', openTasks ? () => openTasks(nodeType, title) : undefined))
    if (ai) records.append(button('查看规则', openRules ? () => openRules(nodeType, title) : undefined))
    const generate = button(ai ? 'AI生成' : nodeType === 'clip_video' ? '生成视频' : nodeType === 'merge_video' ? '合成分集' : '生成/修改')
    generate.title = '该节点尚未接入执行器'
    execution.append(generate)
    if (ai) {
      const modify = button('修改')
      modify.title = '该节点尚未接入执行器'
      execution.append(modify)
    }
    buttons.append(records, execution); ui.append(buttons)
    if (ai) {
      state.nodeOpinions ||= {}
      const input = element('input', '', 'node-ui-opinion'), error = element('p', '', 'error node-ui-failure')
      input.placeholder = '本次执行意见'; input.setAttribute('aria-label', `${title}本次执行意见`)
      input.value = state.nodeOpinions[nodeType] ?? node.node_state.opinion ?? ''; input.readOnly = !saveOpinion
      error.setAttribute('role', 'status')
      let saved = node.node_state.opinion ?? '', chain = Promise.resolve()
      input.oninput = () => { state.nodeOpinions[nodeType] = input.value }
      input.onblur = () => {
        const value = input.value
        chain = chain.then(async () => {
          if (!saveOpinion || value === saved) return
          input.setAttribute('aria-busy', 'true'); error.textContent = ''
          try { await saveOpinion(nodeType, value, saved); saved = value }
          catch (failure) { error.textContent = failure.message }
          finally { input.removeAttribute('aria-busy') }
        })
      }
      ui.append(input, error)
    }
    if (node?.node_state?.last_execution) {
      const last = node.node_state.last_execution
      const notice = element('p', `上次执行：${last.message}`, 'node-last-execution')
      notice.dataset.stopCode = last.stop_code; ui.append(notice)
    }
    section.append(ui)
    if (!rows.length) section.append(element('p', `暂无${title}`, 'production-empty'))
    rows.forEach((row, index) => {
      const value = row.video_generation || row
      const card = element('article', '', 'production-card')
      const label = row.title || row.name || (title === '分集' ? `第 ${index + 1} 集` : `${title} ${index + 1}`)
      card.append(element('h4', label))
      if (row.clip_id) card.append(element('p', row.clip_id, 'production-meta'))
      const { title: _title, name: _name, ...fields } = value
      const text = readable(fields)
      if (text) card.append(element('p', text, 'production-text'))
      section.append(card)
    })
    body.append(section)
  }
  function paint() {
    for (const button of nav.children) {
      const active = button.id === `${panelId}-${state.productionTab}`
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1
      if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current')
    }
    body.setAttribute('aria-labelledby', `${panelId}-${state.productionTab}`)
    body.replaceChildren()
    const [key, title, field] = stages.find(([key]) => key === state.productionTab)
    const node = project[key]
    cards(title, field ? node?.[field] || [] : node || [], node, key === 'videos' ? 'clip_video' : key === 'episodes' ? 'merge_video' : key)
    if (key === 'shot_design') cards('分片编排', project.clip_arrangement?.clips || [], project.clip_arrangement, 'clip_composition')
  }
  paint()
  nav.querySelector('[aria-selected="true"]').scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
