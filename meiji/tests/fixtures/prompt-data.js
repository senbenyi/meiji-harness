// 读取提示词标题下的单行 JSON 资料，断言字段而非展示措辞。
export function promptData(text, title) {
  const marker = `${title}\n`, index = text.indexOf(marker)
  if (index < 0) throw new Error(`缺少提示词资料块：${title}`)
  return JSON.parse(text.slice(index + marker.length).split('\n\n')[0])
}
