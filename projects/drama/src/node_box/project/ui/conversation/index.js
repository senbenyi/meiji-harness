export const conversation = {
  renderInput(body, data, { node, payload }) {
    if (typeof data.original_script === 'string') payload(body, '原始剧本', data.original_script)
    else for (const [key, label] of [['name', '项目名称'], ['creation_mode', '创作模式'], ['aspect_ratio', '画幅']])
      if (data[key]) body.append(node('p', `${label}：${data[key]}`))
    return true
  },
}
