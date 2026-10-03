// 将可读的测试剧情转换为网关 JSON 响应；业务代码不接受旧 Markdown 响应。
export function singleShotResponse(source, shotId = 'S01', durationSeconds = 5) {
  const lines = source.split('\n')
  const match = /^(?:-\s*\*\*)?标题：(.+?)(?:\*\*)?$/.exec(lines[0])
  return JSON.stringify({ shots: [{ shotId, durationSeconds, title: match?.[1] || '镜头剧情', content: match ? lines.slice(1).join('\n') : source }] })
}

export function tableResponse(source) {
  const marks = [...source.matchAll(/^## (S\d+) \/ (\d+)s\n/gm)]
  return JSON.stringify({ shots: marks.map((mark, index) => JSON.parse(singleShotResponse(
    source.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? source.length).trim(), mark[1], Number(mark[2]),
  )).shots[0]) })
}
