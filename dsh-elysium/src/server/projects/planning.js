// 职责：按步骤拼装 Skill、生成 Markdown 并保存解析通过的文档。
import { createSkillsStore } from '../../database/managers/skills.js'
import { readFile } from '../../database/files.js'
import { skillsRoot } from '../../database/paths.js'
import { join } from 'node:path'
import { createDirectorStore } from '../../database/managers/directors.js'
import { statusError } from '../../utils/errors.js'
import { insertStoryboard, parseProject, parseScript, parseSeries, shotMarker, stripVideoDialogue } from './documents.js'
import { FLOW_SKILL, flowSteps } from '../../database/managers/flow.js'

const invalid = message => statusError(400, message)
const schema = { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'], additionalProperties: false }
const optional = (skills, name, path) => skills.reference(name, path).catch(error => { if (error.code === 'ENOENT') return ''; throw error })
const sourceLines = script => parseScript(script).lines.map((line, index) => `${index + 1}. ${line.text}`).join('\n')

export function createPlanningService(store, complete, directors = createDirectorStore()) {
  const skills = createSkillsStore()
  async function assemble(step, context) {
    if (!flowSteps.includes(step)) throw invalid('文档步骤无效')
    const directorName = context.director || parseProject(context.project_text).director
    const [base, director, stepText, reference] = await Promise.all([
      skills.get(FLOW_SKILL), directors.get(directorName), readFile(join(skillsRoot(), FLOW_SKILL, 'steps', `${step}.md`), 'utf8'), optional(skills, directorName, `${step}.md`),
    ])
    const input = step === 'project' ? { director: director.display_name, requirements: context.request || '' }
      : step === 'series' ? { project: parseProject(context.project_text), requirements: context.request || '' }
      : step === 'script' ? { series: parseSeries(context.series_text), episode: context.episode,
        previous_last_scene: context.previous_script?.split(/(?=^## 场 )/m).at(-1) || '', requirements: context.request || '' }
        : { series: parseSeries(context.series_text), episode: context.episode, numbered_lines: sourceLines(context.script),
          requirements: context.request || '' }
    return { name: `drama_${step}`, schema, llm: base.metadata?.llm,
      system: [base.content, stepText, director.files['SKILL.md'], reference].filter(Boolean).join('\n\n'), user: JSON.stringify(input) }
  }
  async function read({ id, step, episode }) {
    const project = await store.read(id)
    if (step === 'project') return { markdown: project.project_text, value: parseProject(project.project_text) }
    if (step === 'series') return { markdown: project.series_text, value: parseSeries(project.series_text) }
    if (step === 'script' || step === 'storyboard') {
      const script = project.episodes.find(item => item.number === episode)?.script || ''
      return { markdown: script, value: parseScript(script) }
    }
    throw invalid('文档步骤无效')
  }
  async function save({ id, step, episode, markdown }) {
    if (typeof markdown !== 'string') throw invalid('文档内容无效')
    if (step === 'project') parseProject(markdown)
    else if (step === 'series') parseSeries(markdown)
    else if (step === 'script' || step === 'storyboard') parseScript(markdown)
    else throw invalid('文档步骤无效')
    return store.saveDoc(id, step === 'storyboard' ? 'script' : step, markdown, episode)
  }
  async function generate({ id, step, episode, shot_id: shotId, director, request = '' }) {
    const project = id ? await store.read(id) : { project_text: '', series_text: '', episodes: [] }
    const script = project.episodes.find(item => item.number === episode)?.script || ''
    const previousScript = project.episodes.find(item => item.number === episode - 1)?.script || ''
    const prompt = await assemble(step, { ...project, director, episode, script, previous_script: previousScript, request })
    const result = await complete(prompt)
    if (typeof result?.markdown !== 'string' || !result.markdown.trim()) throw invalid('模型未返回 Markdown')
    // 模型偶尔用代码围栏包裹整份 Markdown，保存前去掉。
    result.markdown = result.markdown.trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/, '$1')
    if (step === 'project') {
      const value = parseProject(result.markdown)
      return { markdown: result.markdown, value }
    }
    if (step === 'storyboard') {
      if (!script) throw invalid('请先写本集剧本')
      if (shotId) {
        const parsed = parseScript(script), shot = parsed.shots.find(item => item.id === shotId)
        if (!shot) throw invalid('镜头不存在')
        const match = /^### 从第 \d+ 行｜([^｜]+)｜([^｜]+)｜(\d+) 秒(?:｜人物：([^\n]*))?\n视频：([^\n]*)\n首帧：([^\n]*)/.exec(result.markdown.trim())
        if (!match) throw invalid('单镜输出格式无效')
        const lines = script.split('\n'), start = shot.start
        lines[start] = shotMarker(shot.id, match[1], match[2], match[3], match[4])
        lines[start + 1] = `视频：${stripVideoDialogue(match[5])}`; lines[start + 2] = `首帧：${match[6]}`
        return save({ id, step, episode, markdown: lines.join('\n') })
      }
      return save({ id, step, episode, markdown: insertStoryboard(script, result.markdown) })
    }
    if (step === 'series') parseSeries(result.markdown)
    else parseScript(result.markdown)
    return save({ id, step, episode, markdown: result.markdown })
  }
  return { assemble, generate, save, read }
}
