// 只识别独立分场标题，时间标记、场内镜头和对白不作为分集边界。
export function scriptScenes(script = '') {
  const headings = [...String(script).matchAll(/^[ \t]*(?:#{1,6}[ \t]+)?(?:第[零〇一二三四五六七八九十百两\d]+场|场[ \t]*\d+|Scene[ \t]+\d+)(?:[ \t]*[：:、.．—-][^\r\n]*|[ \t]+[^\r\n]*|[ \t]*)\r?$/gim)]
  const common = headings.length ? script.slice(0, headings[0].index).trim() : ''
  return headings.map((heading, index) => {
    const content = script.slice(heading.index, headings[index + 1]?.index ?? script.length).trim()
    const duration = content.match(/^[ \t]*(?:预计时长|场次时长|时长)[ \t]*[：:][ \t]*(?:约|大约)?[ \t]*(\d+(?:\.\d+)?)[ \t]*(分钟|分|秒)/m)
    const durationSeconds = duration ? Number(duration[1]) * (duration[2] === '秒' ? 1 : 60) : null
    return { number: index + 1, title: heading[0].trim().replace(/^#+\s*/, ''), content, common,
      durationSeconds: Number.isInteger(durationSeconds) && durationSeconds > 0 && durationSeconds <= 86400 ? durationSeconds : null }
  })
}

export function episodeScriptScene(project, number = project.episodeNumber || 1) {
  if (project.mode !== 'script') return null
  const scenes = scriptScenes(project.script)
  if (!scenes.length) return null
  if (!Number.isInteger(number) || number < 1 || number > scenes.length) throw new Error(`剧本共有 ${scenes.length} 场，无法生成第 ${number} 集；请先补充剧本分场。`)
  return scenes[number - 1]
}
