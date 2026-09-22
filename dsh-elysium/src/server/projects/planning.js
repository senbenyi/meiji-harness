// 职责：按步骤拼装 Skill、生成 Markdown 并保存解析通过的文档。
import { createSkillsStore } from '../../database/managers/skills.js'
import { readFile } from '../../database/files.js'
import { skillsRoot } from '../../database/paths.js'
import { join } from 'node:path'
import { createDirectorStore } from '../../database/managers/directors.js'
import { statusError } from '../../utils/errors.js'
import { insertStoryboard, parseProject, parseScript, parseSeries, shotMarker, stripVideoDialogue, validateScript } from './documents.js'
import { FLOW_SKILL, flowSteps } from '../../database/managers/flow.js'

const invalid = message => statusError(400, message)
const schema = { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'], additionalProperties: false }
const optional = (skills, name, path) => skills.reference(name, path).catch(error => { if (error.code === 'ENOENT') return ''; throw error })
const sourceLines = (script, shotId) => {
  const parsed = parseScript(script), shot = shotId && parsed.shots.find(item => item.id === shotId)
  if (shotId && !shot) throw invalid('镜头不存在')
  const selected = shot ? new Set(shot.lines) : new Set(parsed.lines)
  return { numbered_lines: parsed.lines.map((line, index) => selected.has(line) ? `${index + 1}. ${line.text}` : null).filter(Boolean).join('\n'),
    scenes: parsed.scenes.filter(scene => scene.lines.some(line => selected.has(line))).map(scene => ({ number: scene.number, name: scene.name, roles: scene.roles,
      first_line: parsed.lines.indexOf(scene.lines[0]) + 1, last_line: parsed.lines.indexOf(scene.lines.at(-1)) + 1 })),
    ...(shot ? { target_shot: { id: shot.id, first_line: parsed.lines.indexOf(shot.lines[0]) + 1, duration: shot.duration } } : {}) }
}

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
        : { series: parseSeries(context.series_text), episode: context.episode, ...sourceLines(context.script, context.shot_id),
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
    else if (step === 'script' || step === 'storyboard') {
      const project = await store.read(id)
      validateScript(project.series, parseScript(markdown), { storyboard: step === 'storyboard' })
    }
    else throw invalid('文档步骤无效')
    return store.saveDoc(id, step === 'storyboard' ? 'script' : step, markdown, episode)
  }
  async function generate({ id, step, episode, shot_id: shotId, director, request = '' }) {
    const project = id ? await store.read(id) : { project_text: '', series_text: '', episodes: [] }
    const script = project.episodes.find(item => item.number === episode)?.script || ''
    const previousScript = project.episodes.find(item => item.number === episode - 1)?.script || ''
    const prompt = await assemble(step, { ...project, director, episode, script, shot_id: shotId, previous_script: previousScript, request })
    let feedback
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await complete(feedback ? { ...prompt, user: JSON.stringify({ ...JSON.parse(prompt.user), correction: feedback }) } : prompt)
      try {
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
            const match = /^### 从第 (\d+) 行｜([^｜]+)｜([^｜]+)｜(\d+) 秒(?:｜人物：([^\n]*))?\n视频：([^\n]*)\n首帧：([^\n]*)/.exec(result.markdown.trim())
            if (!match || result.markdown.trim().split(/(?=^### 从第 )/m).length !== 1 || Number(match[1]) !== parsed.lines.indexOf(shot.lines[0]) + 1) throw invalid('单镜输出必须仅包含目标镜头并保持原起始行')
            const lines = script.split('\n'), start = shot.start
            lines[start] = shotMarker(shot.id, match[2], match[3], match[4], match[5])
            lines[start + 1] = `视频：${stripVideoDialogue(match[6])}`; lines[start + 2] = `首帧：${match[7]}`
            return await save({ id, step, episode, markdown: lines.join('\n') })
          }
          return await save({ id, step, episode, markdown: insertStoryboard(script, result.markdown) })
        }
        if (step === 'series') parseSeries(result.markdown)
        else parseScript(result.markdown)
        return await save({ id, step, episode, markdown: result.markdown })
      } catch (error) {
        if (error.status !== 400 || attempt === 1) throw error
        feedback = { previous_output: result?.markdown || '', error: error.message, instruction: '修正上述错误，返回完整有效的本步骤输出；保留原剧情，不新增总览以外的角色和场景。' }
      }
    }
  }
  return { assemble, generate, save, read }
}
