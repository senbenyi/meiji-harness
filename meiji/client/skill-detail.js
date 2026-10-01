// 技能详情页：基础 skill（查看、编辑后替换内置、恢复内置、撤回上一版、内置更新对比）、本剧补充、指导（本剧启用与素材）、请求预览。
// 基础修改对所有剧生效，保存前在页内确认；本剧补充只对当前短剧生效。会话 agent 没有对应工具，不能修改技能。
import { element, tabs } from './dom.js'
import { assetGuidance, guidanceTypes } from '../shared/guidance.js'
import { assetStageOf } from './skill-entry.js'

const fieldLabels = { common: '通用', generate: '生成', review: '审核', revise: '修订', protocol: '协议（只读）', text: '正文', outline: '剧情整包', shots: '镜头表', seconds: '每秒指令', storyboard: '文本分镜' }
const kindLabels = { stage: '阶段技能', guidance: '指导技能', shared: '共享模块' }
const guidanceLabels = { action: '动作指导', martial: '武术指导', dialogue: '台词指导', expression: '表情指导', sound: '声音指导', '': '其他参考' }
const requestLabels = { generate: '生成', modify: '意见修改', review: '审核', revise: '自动修订', image: '图片接口', video: '成片提交', characters_generate: '提取人物', characters_modify: '人物意见修改', characters_review: '人物审核', characters_revise: '人物自动修订', scenes_generate: '提取场景', scenes_modify: '场景意见修改', scenes_review: '场景审核', scenes_revise: '场景自动修订' }
const sourceLabels = { stage: '阶段技能', constraint: '固定约束', guidance: '指导技能', shared: '共享模块', project: '本剧补充', asset: '指导素材', context: '任务与上下文', protocol: '协议', language: '语言', reference: '官方参考' }

function button(text, onclick, className) {
  const node = element('button', text, className)
  node.type = 'button'
  node.onclick = onclick
  return node
}

function statusLine() {
  const line = element('p', '', 'meta skill-status')
  line.setAttribute('role', 'status')
  return line
}

// 基础 skill：按字段页签展示；编辑保存需页内确认「对所有剧生效」。
function renderBase(skill, handlers, redraw) {
  const group = element('section', '', 'settings-group skill-base')
  const fields = [...skill.fields.map(item => item.field), ...(skill.protocol ? ['protocol'] : [])]
  let active = fields.find(field => field === 'generate') || fields[0]
  const body = element('div', '', 'skill-field')
  const status = statusLine()
  const paint = () => {
    body.replaceChildren()
    if (active === 'protocol') {
      body.append(element('p', '程序解析依赖的输出格式，由代码持有，不可编辑；任何修改都不会改变输出格式与解析。', 'meta'), element('pre', skill.protocol, 'skill-text'))
      return
    }
    const field = skill.fields.find(item => item.field === active)
    const badges = element('p', '', 'skill-badges')
    badges.append(element('span', field.layer === 'base' ? '已修改（替换内置）' : '内置', `skill-badge is-${field.layer}`))
    if (field.outdated) badges.append(element('span', '内置已更新，可对比后决定是否恢复', 'skill-badge is-outdated'))
    const text = element('pre', field.text || '（空）', 'skill-text')
    const tools = element('div', '', 'skill-actions')
    const edit = button('编辑', () => {
      const input = document.createElement('textarea')
      input.value = field.text
      input.setAttribute('aria-label', `编辑基础 skill · ${fieldLabels[active]}`)
      const confirmRow = element('div', '', 'skill-confirm')
      const save = button('保存', () => {
        confirmRow.replaceChildren(element('span', '保存后替换内置，对所有剧生效（进行中的任务不受影响）。'),
          button('确认保存', async () => {
            status.textContent = '正在保存…'
            try { redraw((await handlers.saveBase({ [active]: input.value })).skill, '已保存基础 skill，对所有剧生效') }
            catch (error) { status.textContent = error.message }
          }, 'primary'),
          button('取消', () => confirmRow.replaceChildren(save, cancel)))
      }, 'primary')
      const cancel = button('取消', paint)
      confirmRow.append(save, cancel)
      body.replaceChildren(badges, input, confirmRow)
    })
    tools.append(edit)
    const reset = async (to, message) => {
      status.textContent = '正在恢复…'
      try { redraw((await handlers.reset(to, active)).skill, message) }
      catch (error) { status.textContent = error.message }
    }
    if (field.layer === 'base') tools.append(button('恢复内置', () => reset('builtin', '已恢复内置')))
    if (field.previous) tools.append(button('撤回上一版', () => reset('previous', '已撤回到上一版')))
    body.append(badges, text, tools)
    if (field.layer === 'base' || field.outdated) {
      const compare = element('details', '', 'skill-compare')
      compare.append(element('summary', '对比内置版本'), element('pre', field.builtin || '（空）', 'skill-text'))
      body.append(compare)
    }
  }
  group.append(element('h3', '基础 skill'), element('p', '内置技能随插件更新；在此修改后替换内置，对所有剧生效。', 'meta'),
    tabs('基础 skill 字段', fields.map(field => [field, fieldLabels[field] || field]), active, key => { active = key; paint() }), body, status)
  paint()
  return group
}

// 本剧补充：同样的字段，追加在对应字段之后，只对本剧生效。
function renderAdditions(skill, additions, handlers) {
  const group = element('section', '', 'settings-group skill-additions')
  const fields = skill.fields.map(item => item.field)
  const values = { ...additions }
  let active = fields.includes('generate') ? 'generate' : fields[0]
  const input = document.createElement('textarea')
  input.maxLength = 20000
  input.rows = 8
  const status = statusLine()
  const sync = () => { values[active] = input.value }
  const paint = () => {
    input.value = values[active] || ''
    input.setAttribute('aria-label', `本剧补充 · ${fieldLabels[active] || active}`)
    input.placeholder = `只对本剧生效的${fieldLabels[active] || active}补充要求…`
  }
  input.oninput = sync
  const save = button('保存本剧补充', async () => {
    sync()
    status.textContent = '正在保存…'
    try { await handlers.saveAddition(Object.fromEntries(fields.map(field => [field, values[field] || '']))); status.textContent = '已保存，下次生成生效' }
    catch (error) { status.textContent = error.message }
  }, 'primary')
  group.append(element('h3', '本剧补充'), element('p', '追加在基础 skill 对应字段之后，只对本剧所有集生效；不改变输出协议、素材引用协议和语言配置。', 'meta'),
    tabs('本剧补充字段', fields.map(field => [field, fieldLabels[field] || field]), active, key => { sync(); active = key; paint() }), input, save, status)
  paint()
  return group
}

// 本阶段适用的指导技能：本剧启用开关与详情入口。
function renderGuidance(skill, enabled, handlers) {
  const group = element('section', '', 'settings-group skill-guidance')
  const selected = new Set(enabled)
  const status = statusLine()
  const list = element('div')
  for (const item of skill.guidance) {
    const row = element('div', '', 'guidance-choice')
    const label = element('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.value = item.name
    checkbox.checked = selected.has(item.name)
    checkbox.onchange = async () => {
      if (checkbox.checked) selected.add(item.name); else selected.delete(item.name)
      status.textContent = '正在保存…'
      try { await handlers.saveGuidance([...selected]); status.textContent = '已保存，下次生成生效' }
      catch (error) { checkbox.checked = !checkbox.checked; status.textContent = error.message }
    }
    label.append(checkbox, element('span', `${item.label}${item.defaultEnabled ? '' : '（默认关闭）'}`))
    row.append(label, element('p', `本阶段落点：${item.placement}`, 'meta'), button('查看指导 skill →', () => handlers.open(item.id), 'link'))
    list.append(row)
  }
  group.append(element('h3', '指导'), element('p', '勾选的指导在本剧启用：生成要求进入生成请求，验收条目进入自检与审核。指导只细化上游已有内容，不新增事件。', 'meta'), list, status)
  return group
}

// 指导素材：按指导分组选择，保存到本剧的本阶段。
function renderAssets(stage, selectedAssets, handlers) {
  const group = element('section', '', 'settings-group skill-assets')
  const selected = new Map((selectedAssets || []).map(asset => [asset.id, asset]))
  let assets = [...selected.values()]
  const list = element('div'), count = element('p', '', 'meta'), status = statusLine()
  const filter = document.createElement('select')
  filter.setAttribute('aria-label', '按指导筛选素材')
  for (const [value, label] of [['*', '全部指导'], ...Object.entries(guidanceLabels)]) { const option = element('option', label); option.value = value; filter.append(option) }
  const loadStatus = element('p', '正在读取指导素材…', 'meta')
  const owner = asset => assetGuidance[asset.guidanceType || 'other'] ?? ''
  const render = () => {
    count.textContent = `已选择 ${selected.size}/20 个 · 合计 ${[...selected.values()].reduce((sum, asset) => sum + asset.content.length, 0)}/60000 字`
    list.replaceChildren()
    const visible = assets.filter(asset => filter.value === '*' || owner(asset) === filter.value)
    if (!visible.length) list.append(element('p', '暂无这一指导的素材，请先到「片库 → 素材 → 指导提示词」按分类导入。', 'empty'))
    for (const key of Object.keys(guidanceLabels)) {
      const entries = visible.filter(asset => owner(asset) === key)
      if (!entries.length) continue
      list.append(element('h4', guidanceLabels[key]))
      for (const asset of entries) {
        const card = element('article', '', 'guidance-choice'), label = element('label')
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(asset.id); checkbox.value = asset.id
        checkbox.onchange = () => { if (checkbox.checked) selected.set(asset.id, asset); else selected.delete(asset.id); render() }
        const type = guidanceTypes.find(([value]) => value === asset.guidanceType)?.[1] || '其他'
        label.append(checkbox, element('span', `${type} · ${asset.name || asset.originalName}`))
        const preview = element('details', '', 'guidance-preview')
        preview.append(element('summary', '预览提示词'), element('pre', asset.content, 'guidance-text'))
        card.append(label, preview)
        list.append(card)
      }
    }
  }
  filter.onchange = render
  const save = button('保存指导素材', async () => {
    if (selected.size > 20 || [...selected.values()].reduce((sum, asset) => sum + asset.content.length, 0) > 60000) { status.textContent = '每阶段最多选择 20 个指导素材，合计不超过 60000 字'; return }
    status.textContent = '正在保存…'
    try { await handlers.saveAssets(stage, [...selected.keys()]); status.textContent = '已保存，下次生成生效' }
    catch (error) { status.textContent = error.message }
  }, 'primary')
  group.append(element('h3', '指导素材'), element('p', stage === 'film'
    ? '成片指导素材先编入文本分镜并审核。更换素材后，各集已有产物保留并标记待更新，下一次生成成片会先更新文本分镜。'
    : '素材是参考例子，按所属指导分组编入提示词，可按剧情选用；对本剧所有集生效。取消勾选只解除引用，不删除原文件。', 'meta'), filter, count, loadStatus, list, save, status)
  render()
  Promise.resolve().then(handlers.loadAssets).then(data => {
    assets = [...new Map([...selected.values(), ...data.assets].map(asset => [asset.id, asset])).values()]
    loadStatus.textContent = ''
    render()
  }).catch(error => { loadStatus.textContent = `读取素材失败：${error.message}；已选素材仍保留。` })
  return group
}

// 请求预览：按来源着色的分段、字数；不调用模型。
export function renderRequests(requests) {
  const wrap = element('div', '', 'skill-preview-requests')
  for (const [key, message] of Object.entries(requests)) {
    if (!message) continue
    const item = element('details', '', 'skill-preview-request')
    item.append(element('summary', `${requestLabels[key] || key} · ${message.chars} 字`))
    for (const [role, segments] of [['system', message.system], ['user', message.user]]) {
      if (!segments.length) continue
      const block = element('div', '', 'skill-preview-role')
      block.append(element('h4', role))
      for (const segment of segments.filter(entry => entry.text)) {
        const node = element('div', '', `skill-seg seg-${segment.source}`)
        node.append(element('span', `${sourceLabels[segment.source] || segment.source}${segment.title ? ' ' + segment.title : ''} · ${segment.text.length} 字`, 'skill-seg-title'), element('pre', segment.text, 'skill-text'))
        block.append(node)
      }
      item.append(block)
    }
    wrap.append(item)
  }
  return wrap
}

function renderPreview(skill, handlers) {
  const group = element('section', '', 'settings-group skill-preview')
  const output = element('div'), status = statusLine()
  const mode = document.createElement('select')
  mode.setAttribute('aria-label', '文本分镜模式')
  for (const [value, label] of [['reference', '多模态参考'], ['text', '文生视频']]) { const option = element('option', label); option.value = value; mode.append(option) }
  const run = button('预览请求', async () => {
    status.textContent = '正在组装…'
    try {
      const { requests } = await handlers.preview(skill.id === 'storyboard' ? mode.value : '')
      output.replaceChildren(renderRequests(requests))
      status.textContent = '以下为按当前已保存内容组装的请求，未调用模型'
    } catch (error) { status.textContent = error.message }
  })
  group.append(element('h3', '预览'), element('p', '用当前剧集的实际上下文组装请求，按来源着色并显示字数；缺少上游内容时以说明代替上下文。', 'meta'))
  if (skill.id === 'storyboard') group.append(mode)
  group.append(run, status, output)
  return group
}

export function renderSkillDetail({ id, project }, handlers) {
  const page = element('section', '', 'settings-page skill-detail')
  const status = statusLine()
  page.append(button('← 返回', handlers.back, 'back'), element('p', '正在读取技能…', 'meta'))
  const draw = (data, message = '') => {
    const { skill } = data
    const children = [button('← 返回', handlers.back, 'back'), element('h2', `${skill.label} · skill`),
      element('p', `${kindLabels[skill.kind]}${project && skill.fields.length && !skill.nodeScoped ? ` · 本剧补充只对《${project.title || '本剧'}》生效` : ''}`, 'meta')]
    for (const related of skill.related || []) children.push(button(`查看相关技能：${related === 'shot-revise' ? '单镜修订' : related === 'shots' ? '镜头表' : related} →`, () => handlers.open(related), 'link'))
    if (skill.stages?.length) children.push(element('p', `落点：${skill.stages.map(item => `${fieldLabels[item.stage]}（${item.placement}）`).join('；')}`, 'meta'))
    const redraw = (next, text) => { handlers.changed?.(); draw({ ...data, skill: next }, text) }
    if (Object.hasOwn(skill, 'constraints')) {
      const fixed = element('section', '', 'settings-group skill-constraints')
      fixed.append(element('h3', '固定约束（只读）'), element('p', '由技能文件提供，不能在页面修改或覆盖。', 'meta'), element('pre', skill.constraints.trim() || '无固定约束', 'skill-text'))
      children.push(fixed)
    }
    if (skill.fields.length || skill.protocol) children.push(renderBase(skill, handlers, redraw))
    if (data.project && !skill.nodeScoped && skill.kind !== 'shared' && skill.fields.length) children.push(renderAdditions(skill, data.project.additions, handlers))
    if (skill.nodeScoped) children.push(element('p', '补充 skill 请在对应剧集的摘要、大纲、人物或场景节点管理。', 'meta'))
    if (data.project && skill.guidance?.length) children.push(renderGuidance(skill, data.project.enabled, handlers))
    if (data.project && skill.kind === 'guidance') {
      const name = skill.id.replace(/^guidance-/, '')
      children.push(renderGuidance({ guidance: [{ id: skill.id, name, label: `在本剧启用${skill.label}`, placement: skill.stages.map(item => fieldLabels[item.stage]).join('、'), defaultEnabled: true }] }, data.project.enabled, { ...handlers, saveGuidance: async list => handlers.saveGuidance([...new Set([...data.project.enabled.filter(item => item !== name), ...list])]) }))
    }
    if (data.project && assetStageOf[skill.id]) children.push(renderAssets(assetStageOf[skill.id], data.project.assets[assetStageOf[skill.id]], handlers))
    if (skill.kind === 'stage') children.push(renderPreview(skill, handlers))
    status.textContent = message
    children.push(status)
    page.replaceChildren(...children)
  }
  Promise.resolve().then(handlers.load).then(data => draw(data)).catch(error => page.replaceChildren(button('← 返回', handlers.back, 'back'), element('p', `读取技能失败：${error.message}`, 'error')))
  return page
}
