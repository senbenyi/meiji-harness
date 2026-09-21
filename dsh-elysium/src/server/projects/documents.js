// 职责：解析项目、总览和单集 Markdown，并把分镜标记插入原剧本行。
import { statusError } from '../../utils/errors.js'

const invalid = (line, reason) => statusError(400, `第 ${line} 行：${reason}`)
const value = (line, prefix) => line.startsWith(prefix) ? line.slice(prefix.length).trim() : null
export const stripVideoDialogue = video => video.replace(/([^【；。\n]+?)（[^）]+）：[^；【\n]+/g, '$1开口')

export function parseProject(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown)
  if (!match) throw invalid(1, '项目缺少 frontmatter')
  const fields = Object.fromEntries(match[1].split('\n').map(line => { const index = line.indexOf(':'); return [line.slice(0, index).trim(), line.slice(index + 1).trim()] }))
  if (!fields.title) throw invalid(1, '项目需要 title')
  return { title: fields.title, director: fields.director, genre: fields.genre, synopsis: match[2].trim() }
}

export function projectMarkdown({ title, director, genre, synopsis = '' }) {
  return `---\ntitle: ${title}\ndirector: ${director}\ngenre: ${genre}\n---\n\n${synopsis.trim()}\n`
}

export function parseSeries(markdown) {
  if (!markdown.trim()) return null
  const lines = markdown.split('\n'), result = { logline: '', world: '', characters: [], scenes: [], episodes: [] }
  let section = '', current = null, field = ''
  for (const [index, line] of lines.entries()) {
    const text = line.trim()
    if (!text) continue
    if (text.startsWith('一句话故事：')) { result.logline = value(text, '一句话故事：'); continue }
    if (/^## /.test(text)) { section = text.slice(3); current = null; field = ''; continue }
    if (/^### /.test(text)) {
      if (section === '角色') { const name = text.slice(4); current = { name: name.replace(/（主角）$/, ''), lead: name.endsWith('（主角）'), intro: '', appearance: '', voice: '' }; result.characters.push(current) }
      else if (section === '场景') { current = { name: text.slice(4), description: '' }; result.scenes.push(current) }
      else if (section === '分集') { const match = /^### 第 (\d+) 集 · (.+)$/.exec(text); if (!match) throw invalid(index + 1, '分集标题格式无效'); current = { number: Number(match[1]), title: match[2], summary: '', hook: '' }; result.episodes.push(current) }
      else throw invalid(index + 1, '标题不在有效区块内')
      continue
    }
    if (section === '世界观') result.world += (result.world ? '\n' : '') + text
    else if (section === '角色' && current) {
      const key = text.startsWith('简介：') ? 'intro' : text.startsWith('定妆：') ? 'appearance' : text.startsWith('音色：') ? 'voice' : null
      if (!key) throw invalid(index + 1, '角色字段无效')
      current[key] = text.slice(3).trim()
    } else if (section === '场景' && current) current.description += (current.description ? '\n' : '') + text
    else if (section === '分集' && current) {
      const key = text.startsWith('梗概：') ? 'summary' : text.startsWith('钩子：') ? 'hook' : null
      if (!key) throw invalid(index + 1, '分集字段无效')
      current[key] = text.slice(3).trim()
    } else throw invalid(index + 1, '内容不在有效区块内')
  }
  if (!result.logline || !result.characters.some(item => item.lead) || !result.episodes.length || result.episodes.some((item, index) => item.number !== index + 1)) throw invalid(1, '总览缺少一句话故事、主角或连续分集')
  return result
}

export function parseScript(markdown) {
  const lines = markdown.split('\n'), scenes = [], shots = [], scriptLines = []
  let scene = null, shot = null, next = 1, changed = false
  for (const [index, line] of lines.entries()) {
    const text = line.trim()
    if (!text) continue
    if (text.startsWith('## ')) {
      const match = /^## 场 (\d+)｜([^｜]+)｜(.+)$/.exec(text)
      if (!match) throw invalid(index + 1, '场标题格式无效')
      scene = { number: Number(match[1]), name: match[2], roles: match[3].split('、').filter(Boolean), start: index, lines: [] }
      scenes.push(scene); shot = null; continue
    }
    if (text === '<!-- 未入镜 -->') { shot = null; continue }
    if (text.startsWith('### ')) {
      if (!scene) throw invalid(index + 1, '镜头不能早于场')
      const match = /^### (?:\[(S\d+)\] )?([^｜]+)｜([^｜]+)｜(\d+) 秒(?:｜人物：(.+))?$/.exec(text)
      if (!match) throw invalid(index + 1, '镜头标记格式无效')
      const id = match[1] || `S${String(next).padStart(2, '0')}`
      if (!match[1]) { lines[index] = line.replace('### ', `### [${id}] `); changed = true }
      next = Math.max(next, Number(id.slice(1)) + 1)
      if (shots.some(item => item.id === id)) throw invalid(index + 1, '镜头号重复')
      shot = { id, scene: scene.name, scene_number: scene.number, size: match[2], camera: match[3], duration: Number(match[4]), roles: match[5]?.split('、') || null,
        start: index, lines: [], video: '', keyframe: '' }
      shots.push(shot); scene.shots ||= []; scene.shots.push(shot); continue
    }
    if (!scene) throw invalid(index + 1, '剧本行不能早于场')
    if (text.startsWith('视频：') || text.startsWith('首帧：')) {
      if (!shot) throw invalid(index + 1, '提示词不能早于镜头')
      shot[text.startsWith('视频：') ? 'video' : 'keyframe'] = text.slice(3).trim()
      continue
    }
    if (!/^(动作：|音效：|[^：]+（[^）]+）：)/.test(text)) throw invalid(index + 1, '剧本行格式无效')
    const item = { text: line, index, scene: scene.name, shot_id: shot?.id || null }
    scene.lines.push(item); scriptLines.push(item); if (shot) shot.lines.push(item)
  }
  return { markdown: changed ? lines.join('\n') : markdown, scenes, shots, lines: scriptLines }
}

export function insertStoryboard(script, output) {
  const parsed = parseScript(script), starts = [], blocks = output.trim().split(/(?=^### 从第 )/m).filter(Boolean)
  for (const block of blocks) {
    const match = /^### 从第 (\d+) 行｜([^｜]+)｜([^｜]+)｜(\d+) 秒\n视频：([^\n]*)\n首帧：([^\n]*)/.exec(block.trim())
    if (!match) throw invalid(1, '分镜输出格式无效')
    const number = Number(match[1]), target = parsed.lines[number - 1]
    if (!target || starts.some(item => item.number >= number)) throw invalid(1, '镜头起始行必须递增且存在')
    starts.push({ number, target, match })
  }
  if (!starts.length || starts[0].number !== 1) throw invalid(1, '分镜必须覆盖第一行')
  for (const scene of parsed.scenes) if (scene.lines.length && !starts.some(item => item.target.scene === scene.name && item.target.index === scene.lines[0].index)) throw invalid(scene.start + 1, '每场首行需要镜头')
  const source = script.split('\n').filter(line => !/^### (?:\[S\d+\] )/.test(line) && line.trim() !== '<!-- 未入镜 -->' && !/^(视频：|首帧：)/.test(line))
  const plain = parseScript(source.join('\n')), byIndex = new Map()
  starts.forEach(({ number, match }, index) => {
    const target = plain.lines[number - 1], id = `S${String(index + 1).padStart(2, '0')}`
    byIndex.set(target.index, `### [${id}] ${match[2]}｜${match[3]}｜${match[4]} 秒\n视频：${stripVideoDialogue(match[5])}\n首帧：${match[6]}`)
  })
  return source.map((line, index) => byIndex.has(index) ? `${byIndex.get(index)}\n${line}` : line).join('\n')
}
