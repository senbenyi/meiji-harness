import { element } from './dom.js'

export function appendWorkflowReview(parent, record, generated, busy = false) {
  const area = element('div', '', 'workflow-review')
  const check = record?.check
  if (!generated) area.append(element('div', '还未生成', 'storyboard-empty'))
  if (generated && check?.passed === false) {
    area.append(element('p', `自检未通过：${check.failures.join('；')}`, 'hint warn'))
  } else if (generated && check?.passed === true) {
    const input = element('input', '', 'workflow-review-input')
    input.type = 'text'
    input.placeholder = '审核意见'
    input.setAttribute('aria-label', '审核意见')
    input.value = record.review?.text || ''
    input.maxLength = 2000
    input.disabled = busy
    area.append(input)
  } else if (generated) area.append(element('p', '尚未完成自检', 'meta'))
  parent.append(area)
  return area
}

export function reviewFields(parent) {
  const input = parent.querySelector(':scope > .workflow-review > input')
  return input ? { review: input.value.trim() } : {}
}
