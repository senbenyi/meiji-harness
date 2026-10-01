import { element } from './dom.js'

const labels = { summary: '摘要', outline: '大纲', characters: '人物角色', scenes: '场景' }
const promptText = request => ['system', 'user'].map(role => `【${role}】\n` + (request[role] || []).filter(item => item.text).map(item => `${item.title || ''}\n${item.text}`).join('\n\n')).join('\n\n')
export function renderNodeSkill(project, nodeKey, { load, save, remove, preview, back }) {
  const view = element('section', '', 'skill-detail-page')
  const returnButton = element('button', '← 返回')
  returnButton.onclick = back
  const error = element('p', '', 'error')
  error.setAttribute('role', 'status')
  const body = element('div')
  view.append(returnButton, element('h2', `${labels[nodeKey] || nodeKey} skill`), element('p', '补充要求仅用于当前剧集的当前节点。保存后对后续任务生效。', 'meta'), error, body)
  let editing = ''
  const run = async (action, button) => {
    if (button) button.disabled = true
    error.textContent = ''
    try { await action() } catch (failure) { error.textContent = failure.message }
    finally { if (button?.isConnected) button.disabled = false }
  }
  const draw = ({ skill, items }) => {
    body.replaceChildren()
    const base = element('details')
    base.append(element('summary', '基础 skill'))
    const text = [skill.constraints, ...skill.fields.filter(field => field.field !== 'protocol').map(field => field.text), skill.protocol].filter(Boolean).join('\n\n')
    base.append(element('pre', text, 'story'))
    body.append(base, element('h3', '当前节点补充 skill'))
    const input = element('textarea')
    input.setAttribute('aria-label', '补充 skill 内容')
    input.maxLength = 10000
    for (const item of items) {
      const row = element('article', '', 'overview-card')
      const edit = element('button', '修改'), drop = element('button', '删除')
      edit.onclick = () => { editing = item.id; input.value = item.content; submit.textContent = '保存修改'; input.focus() }
      drop.onclick = () => run(async () => { draw(await remove(item.id)); editing = '' }, drop)
      row.append(element('p', item.content), edit, drop)
      body.append(row)
    }
    const submit = element('button', '添加补充 skill'), cancel = element('button', '取消修改')
    submit.onclick = () => run(async () => { draw(await save({ id: editing || undefined, content: input.value })); editing = '' }, submit)
    cancel.onclick = () => { editing = ''; input.value = ''; submit.textContent = '添加补充 skill' }
    const show = element('button', '预览完整提示词'), result = element('div')
    show.onclick = () => run(async () => {
      const { requests } = await preview()
      result.replaceChildren()
      for (const [kind, request] of Object.entries(requests)) if (request) {
        const details = element('details'); details.append(element('summary', ({ generate: '生成', modify: '按意见修改', review: '审核', revise: '自动修订' })[kind] || kind), element('pre', promptText(request), 'story')); result.append(details)
      }
    }, show)
    body.append(input, submit, cancel, show, result)
  }
  void run(async () => draw(await load()))
  return view
}
