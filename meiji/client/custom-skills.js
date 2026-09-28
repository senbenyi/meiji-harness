import { element } from './dom.js'
import { request } from './api.js'
import { guidanceTypes, guidanceModule } from './guidance.js'

export const customSkillStages = { outline: '故事大纲', shots: '镜头表', seconds: '每秒分镜', storyboard: '文本分镜', film: '成片' }

export function customSkillField(project, stage, actions) {
  const row = element('div', '', 'custom-skill-field')
  const count = project.guidanceAssets?.[stage]?.length || 0
  const button = element('button', project.customSkills?.[stage] || count ? '编辑补充 skill' : '添加补充 skill')
  button.type = 'button'
  button.setAttribute('aria-label', `${customSkillStages[stage]}自定义 skill`)
  button.onclick = () => actions.openCustomSkill(project, stage)
  row.append(element('span', `${customSkillStages[stage]} · 补充 skill${count ? ` · ${count} 个指导素材` : ''}`), button)
  return row
}

export function renderCustomSkill(project, stage, { save, back, loadAssets = () => request('assets?category=guidance') }) {
  const page = element('section', '', 'settings-page')
  const form = document.createElement('form'), fields = document.createElement('fieldset')
  fields.className = 'custom-skill-inputs'
  const previous = element('button', '← 返回流程', 'back')
  previous.type = 'button'
  previous.onclick = back
  const selected = new Map((project.guidanceAssets?.[stage] || []).map(asset => [asset.id, asset]))
  let assets = [...selected.values()]
  const guidance = element('section', '', 'settings-group'), list = element('div'), count = element('p', '', 'meta')
  const filterLabel = element('label', '素材分类'), filter = document.createElement('select')
  filter.setAttribute('aria-label', '筛选指导素材分类')
  for (const [value, label] of [['', '全部分类'], ...guidanceTypes]) { const option = element('option', label); option.value = value; filter.append(option) }
  filterLabel.append(filter)
  const loadStatus = element('p', '正在读取指导素材…', 'meta')
  const render = () => {
    count.textContent = `已选择 ${selected.size}/20 个 · 合计 ${[...selected.values()].reduce((sum, asset) => sum + asset.content.length, 0)}/60000 字`
    list.replaceChildren()
    const visible = assets.filter(asset => !filter.value || asset.guidanceType === filter.value)
    if (!visible.length) list.append(element('p', '暂无这一分类的指导素材，请先到「片库 → 素材 → 指导提示词」按分类导入。', 'empty'))
    for (const asset of visible) {
      const card = element('article', '', 'guidance-choice'), label = element('label')
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(asset.id)
      checkbox.value = asset.id
      checkbox.onchange = () => { if (checkbox.checked) selected.set(asset.id, asset); else selected.delete(asset.id); render() }
      const name = guidanceTypes.find(([type]) => type === asset.guidanceType)?.[1] || '其他'
      label.append(checkbox, element('span', `${name} · ${asset.name || asset.originalName}`))
      const preview = element('details', '', 'guidance-preview')
      preview.append(element('summary', '预览提示词'), element('pre', asset.content, 'guidance-text'))
      card.append(label, element('p', `编排位置：${guidanceModule(stage, asset.guidanceType || 'other')}`, 'meta'), preview)
      list.append(card)
    }
  }
  filter.onchange = render
  guidance.append(element('h3', '指导素材'), element('p', '按分类选择参考内容，生成时融入对应模块；可按剧情选用，不要求逐条照搬。', 'meta'), filterLabel, count, loadStatus, list)
  render()
  Promise.resolve().then(loadAssets).then(data => {
    assets = [...new Map([...selected.values(), ...data.assets].map(asset => [asset.id, asset])).values()]
    loadStatus.textContent = ''
    render()
  }).catch(error => { loadStatus.textContent = `读取素材失败：${error.message}；已选素材仍保留。` })
  const constraints = element('section', '', 'settings-group')
  const input = document.createElement('textarea')
  input.value = project.customSkills?.[stage] || ''
  input.maxLength = 20000
  input.rows = 12
  input.setAttribute('aria-label', '补充 skill 内容')
  input.placeholder = '填写当前阶段必须遵守的约束，也可说明选中指导素材的使用范围…'
  constraints.append(element('h3', '补充 skill'), element('p', '手动输入约束要求；与参考内容冲突时，以约束为准，输出格式和语言仍遵循基础协议。', 'meta'), input)
  const status = element('p', '', 'meta')
  status.setAttribute('role', 'status')
  const submit = element('button', '保存', 'primary')
  submit.type = 'submit'
  page.append(previous, element('h2', `${customSkillStages[stage]} · 补充 skill`), element('p', stage === 'film'
    ? '成片指导素材先编入文本分镜并自审。更换素材后，旧产物保留并标记待更新，下一次生成成片会先更新文本分镜。手写约束继续在成片提交时生效。'
    : '仅作用于当前剧集的这一阶段，下次生成生效。指导素材保存在本地素材库；取消勾选只解除引用，不删除原文件。', 'meta'))
  fields.append(guidance, constraints, submit)
  form.append(fields, status)
  form.onsubmit = async event => {
    event.preventDefault()
    if (selected.size > 20 || [...selected.values()].reduce((sum, asset) => sum + asset.content.length, 0) > 60000) { status.textContent = '每阶段最多选择 20 个指导素材，合计不超过 60000 字'; return }
    fields.disabled = true
    try { await save(input.value, [...selected.keys()]); status.textContent = '已保存，下次生成生效' }
    catch (error) { status.textContent = error.message }
    finally { fields.disabled = false }
  }
  page.append(form)
  return page
}
