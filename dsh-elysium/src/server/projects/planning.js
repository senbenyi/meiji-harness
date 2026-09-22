// 职责：按步骤拼装 Skill、生成 Markdown 并保存解析通过的文档。
import { createSkillsStore } from '../../database/managers/skills.js'
import { readFile } from '../../database/files.js'
import { skillsRoot } from '../../database/paths.js'
import { join } from 'node:path'
import { createDirectorStore } from '../../database/managers/directors.js'
import { statusError } from '../../utils/errors.js'
import { insertStoryboard, parseProject, parseScript, parseSeries, renderGenerated, shotMarker, stripVideoDialogue, validateScript } from './documents.js'
import { generationSchema, validateGenerated } from './contracts.js'
import { FLOW_SKILL, flowSteps } from '../../database/managers/flow.js'

const invalid = message => statusError(400, message)
const optional = (skills, name, path) => skills.reference(name, path).catch(error => { if (error.code === 'ENOENT') return ''; throw error })
const directorRules = text => {
  const episodes = /- 集数：固定 (\d+) 集/.exec(text), duration = /- 单集时长：(\d+)[–-](\d+) 秒/.exec(text)
  if (!episodes || !duration) throw invalid('导演总览需要固定集数和单集时长')
  return { expected_episodes: Number(episodes[1]), duration_range: { min: Number(duration[1]), max: Number(duration[2]) } }
}
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
    const rules = step === 'project' ? {} : directorRules(director.files['series.md'])
    const input = step === 'project' ? { director: director.display_name, director_id: directorName, requirements: context.request || '' }
      : step === 'series' ? { project: parseProject(context.project_text), expected_episodes: rules.expected_episodes, requirements: context.request || '' }
      : step === 'script' ? { series: parseSeries(context.series_text), episode: context.episode,
        previous_last_scene: context.previous_script?.split(/(?=^## 场 )/m).at(-1) || '', duration_range: rules.duration_range, requirements: context.request || '' }
        : { series: parseSeries(context.series_text), episode: context.episode, ...sourceLines(context.script, context.shot_id),
          duration_range: rules.duration_range, requirements: context.request || '' }
    return { name: `drama_${step}`, schema: generationSchema(step, input), llm: base.metadata?.llm,
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
    const input = JSON.parse(prompt.user)
    let feedback
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await complete(feedback ? { ...prompt, user: JSON.stringify({ ...input, correction: feedback }) } : prompt)
      try {
        validateGenerated(step, result, input)
        const markdown = renderGenerated(step, result, input)
        if (step === 'project') {
          const value = parseProject(markdown)
          return { markdown, value }
        }
        if (step === 'storyboard') {
          if (!script) throw invalid('请先写本集剧本')
          if (shotId) {
            const parsed = parseScript(script), shot = parsed.shots.find(item => item.id === shotId)
            if (!shot) throw invalid('镜头不存在')
            const lines = script.split('\n'), start = shot.start, updated = result.shot
            lines[start] = shotMarker(shot.id, updated.size, updated.camera, updated.duration, updated.roles.join('、'))
            lines[start + 1] = `视频：${stripVideoDialogue(updated.video)}`; lines[start + 2] = `首帧：${updated.keyframe}`
            return await save({ id, step, episode, markdown: lines.join('\n') })
          }
          return await save({ id, step, episode, markdown: insertStoryboard(script, markdown) })
        }
        if (step === 'series') parseSeries(markdown)
        else parseScript(markdown)
        return await save({ id, step, episode, markdown })
      } catch (error) {
        if (error.status !== 400 || attempt >= (error.message.includes('镜头总时长') ? 3 : 1)) throw error
        feedback = { previous_output: result, error: error.message, instruction: '修正上述字段，返回完整结构化结果；保留原剧情，不新增总览以外的角色和场景。' }
      }
    }
  }
  return { assemble, generate, save, read }
}
