export const conversation = {
  renderInput(body, data, { node, payload }) {
    if (!data.current_script && !data.instruction) return false
    if (data.instruction) body.append(node('h4', '修改要求'), node('p', data.instruction))
    const script = data.current_script
    if (script?.actual_script !== undefined) {
      payload(body, '输入正文', script.actual_script)
      if (script.summary) body.append(node('h4', '输入摘要'), node('p', script.summary))
      if (script.estimated_duration_seconds !== undefined) body.append(node('p', `输入预估时长：${script.estimated_duration_seconds} 秒`, 'muted'))
    }
    return true
  },
  renderStepOutput(body, result, { payload }) {
    if (result?.output?.actual_script === undefined) return false
    payload(body, '生成正文', result.output.actual_script)
    return true
  },
  outcome(group) {
    const saved = group.context.saved
    return {
      headline: saved ? '优化完成，已保存' : '操作已完成',
      description: saved ? '审核通过，当前工作稿已更新。' : '本次未更新工作稿。',
      retained: saved ? '已保存部分成果，请查看任务详情。' : '原工作稿保留，本次未更新。',
    }
  },
  appendActions(actions, group, finalReference, { get, modal, payload, node, document, button }) {
    if (group.status === 'completed' && group.context.saved) {
      actions.append(button('查看本次剧本', async () => {
        const data = await get(finalReference)
        if (!data.final_output?.actual_script) throw new Error('本次剧本暂不可读')
        modal('本次保存的剧本', body => payload(body, '剧本', data.final_output.actual_script))
      }), button('对比修改前后', async () => {
        const data = await get(finalReference), before = data.box_input?.current_script?.actual_script, after = data.final_output?.actual_script
        if (typeof before !== 'string' || typeof after !== 'string') throw new Error('缺少当次对比资料')
        modal('本次修改前后', body => {
          const comparison = node('div', undefined, 'compare')
          let prefix = 0, suffix = 0
          while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
          while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
          for (const [title, text] of [['修改前', before], ['修改后', after]]) {
            const column = node('section'), pre = node('pre')
            pre.append(document.createTextNode(text.slice(0, prefix)), node('mark', text.slice(prefix, suffix ? -suffix : undefined)), document.createTextNode(suffix ? text.slice(-suffix) : ''))
            column.append(node('h4', title), pre); comparison.append(column)
          }
          body.append(node('p', '高亮为变化范围；两侧均取本次任务快照。', 'muted'), comparison)
        })
      }))
    }
  },
}
