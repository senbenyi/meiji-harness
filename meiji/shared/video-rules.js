

export function h3PromptFailures(prompt, images = [], mode = images.length ? 'reference' : 'text') {
  const text = String(prompt || '').trim()
  const fields = mode === 'reference'
    ? ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']
    : ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']
  const failures = []
  if (/<(?:Subject|Picture)\s+N\d+>/i.test(text)) failures.push('引用编号必须写 <Subject 1>、<Picture 1>，空格后直接为整数，不能写 <Subject N1> 或 <Picture N1>')
  const marks = fields.map(field => new RegExp(`(?:^|\\n)\\s*${field}\\s*:`, 'i').exec(text))
  if (marks.some((mark, i) => !mark || (i && mark.index <= marks[i - 1]?.index))) {
    failures.push(`H3 ${mode} 提示词必须按顺序包含 ${fields.join('、')}`)
    return failures
  }
  if (marks.some((mark, i) => !text.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? text.length).trim())) failures.push('H3 提示词字段内容不能为空')
  const pictures = [...text.matchAll(/<Picture\s+(\d+)>/g)].map(match => Number(match[1]))
  if (mode === 'reference') {
    if (pictures.some(n => n < 1 || n > images.length) || images.some((_, i) => !pictures.includes(i + 1))) failures.push('参考图片编号与提交素材不一致，所有素材必须按顺序绑定')
    const definitions = text.slice(0, marks[1].index)
    for (let i = 1; i <= images.length; i++) if (!new RegExp(`<Picture\\s+${i}>`).test(definitions)) failures.push(`Picture ${i} 未在 subject_definitions 中绑定主体`)
    const body = text.slice(marks[3].index, marks[4].index)
    const defined = new Set([...definitions.matchAll(/<Subject\s+(\d+)>/g)].map(m => m[1]))
    const used = [...body.matchAll(/<Subject\s+(\d+)>/g)].map(m => m[1])
    if (!defined.size || !used.length || used.some(id => !defined.has(id))) failures.push('主体必须在 subject_definitions 定义，并在 detailed_description 使用；不能引用未定义的 Subject')
    for (const id of defined) if (!used.includes(id)) failures.push(`Subject ${id} 定义后没有在实际镜头描述中使用`)
  } else if (pictures.length || /<Subject\s+\d+>/.test(text)) failures.push('普通/首帧模式不可引用未定义的 Picture 或 Subject')
  return failures
}

export function bindReferencePrompt(prompt, images) {
  const text = String(prompt || '').trim()
  const failures = h3PromptFailures(text, images)
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { status: 409, code: 'CONTENT_CHECK_FAILED' })
  return text
}

export function continuesFrame(value) {
  return /同一画面|同一时刻|接着做|最后一秒|\bsame (?:frame|moment)|\bcontinues? (?:the )?action|\blast second\b/i.test(String(value || ''))
}

export function wantsOpeningFrame({ video, continuity, imageCount, link }) {
  if (link === 'first_last' || video === 'first_frame') return true
  if (video === 'reference' || video === 'text') return false
  if (continuesFrame(continuity)) return true
  return imageCount < 1
}

export function videoRequestMode({ video, continuity, hasOpening, imageCount, link }) {
  const asked = ['text', 'first_frame', 'reference'].includes(video) ? video : ''
  const same = continuesFrame(continuity)
  let mode = link === 'first_last' ? 'first_frame' : (asked || (same && hasOpening ? 'first_frame' : imageCount > 0 ? 'reference' : hasOpening ? 'first_frame' : 'text'))
  if (mode === 'text' && imageCount > 0) mode = 'reference'
  if (mode === 'first_frame' && !hasOpening) throw Object.assign(new Error('这一镜要接上一镜尾帧，请先完成上一镜的成片'), { status: 409 })
  if (mode === 'reference' && !imageCount) throw Object.assign(new Error('这一镜要用参考图，请先上传人物或场景图片'), { status: 409 })
  return mode
}
