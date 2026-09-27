import { element } from './dom.js'
import { shotReferenceImages } from './reference-images.js'
export function referenceReport(project, story) {
  const text = String(story.prompt?.text || '')
  const images = shotReferenceImages(project, story)
  const mentions = [...text.matchAll(/<Picture\s+(\d+)>/gi)].map(match => Number(match[1]))
  const missing = [...new Set(mentions.filter(n => n < 1 || n > images.length))]
  return { missing, rows: images.map((image, i) => {
    const number = i + 1
    const lines = text.split('\n').filter(line => new RegExp(`<Picture\\s+${number}>`, 'i').test(line))
    const subjects = [...new Set(lines.flatMap(line => [...line.matchAll(/<Subject\s+\d+>/gi)].map(match => match[0])))]
    return { ...image, number, lines, subjects, used: mentions.includes(number) }
  }) }
}
export function storyboardReferences(project, story) {
  const box = element('section', '', 'storyboard-references')
  box.dataset.modelKey = `references:${project.episodeId}:${story.id}`
  box.append(element('h4', '关联素材'))
  const { rows, missing } = referenceReport(project, story)
  if (!rows.length) box.append(element('p', '未关联参考图片', 'meta'))
  if (missing.length) box.append(element('p', `提示词引用了不存在的图片：${missing.map(n => `<Picture ${n}>`).join('、')}`, 'hint warn'))
  for (const row of rows) {
    const card = element('article', '', 'reference-card')
    const image = element('img')
    image.alt = row.label || row.name || `图片 ${row.number}`
    image.loading = 'lazy'
    image.src = row.assetId ? '/plugins/meiji/asset-file?' + new URLSearchParams({ category: row.assetCategory || (['props'].includes(row.kind) ? 'props' : row.kind === 'scenes' ? 'scenes' : 'characters'), id: row.assetId }) : row.localPath || (row.url?.startsWith('/') ? row.url : '/plugins/meiji/reference-preview?' + new URLSearchParams({ projectId: project.id, episodeId: project.episodeId, track: story.id, index: row.number - 1 }))
    const detail = element('div')
    detail.append(element('strong', `<Picture ${row.number}> · ${row.label || row.name || row.id}`))
    detail.append(element('p', row.subjects.join('、') || '未找到 Subject 定义', 'meta'))
    if (!row.used) detail.append(element('span', '提示词未引用', 'hint warn'))
    card.append(image, detail); box.append(card)
  }
  return box
}
