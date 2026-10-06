// 读取提示词标题下的单行 JSON 资料，断言字段而非展示措辞。
export function promptData(text, title) {
  const marker = `${title}\n`, index = text.lastIndexOf(marker)
  if (index < 0) throw new Error(`缺少提示词资料块：${title}`)
  const block = text.slice(index + marker.length).split('\n\n')[0]
  if (title === '【本次要求】') {
    const keys = { 时长: 'durationSeconds', 总时长下限: 'minDurationSeconds', 总时长上限: 'maxDurationSeconds', 单镜时长下限: 'minShotDurationSeconds', 单镜时长上限: 'maxShotDurationSeconds', 目标镜头: 'shotId', 开始时间: 'startMs', 结束时间: 'endMs' }
    return Object.fromEntries(block.split('\n').flatMap(line => {
      const canvas = line.match(/^画幅：(\d+) × (\d+) 像素，(横幅|竖幅|正方形)$/)
      if (canvas) return [['width', Number(canvas[1])], ['height', Number(canvas[2])], ['orientation', canvas[3]]]
      const match = line.match(/^([^：]+)：(.+)$/)
      if (!match || !keys[match[1]]) return []
      const value = match[2].replace(/ (秒|毫秒)$/, '')
      return [[keys[match[1]], /Seconds$|Ms$/.test(keys[match[1]]) ? Number(value) : value]]
    }))
  }
  try { return JSON.parse(block) } catch { return block }
}
