// 职责：按通用与导演 Skill 生成五步剧情规划，并管理审核版本。
import { createSkillsStore } from '../../database/managers/skills.js'
import { createDirectorStore } from '../../database/managers/directors.js'
import { validProjectId, validShotId } from '../../database/schemas/projects.js'
import { statusError } from '../../utils/errors.js'
import { planningSchema, planningSteps, validatePlanningResult } from './planning-schema.js'
import { randomBytes } from 'node:crypto'

const invalid = message => statusError(400, message)
const conflict = message => statusError(409, message)
const finalized = entry => entry?.versions.find(item => item.version === entry.finalized)?.value

export function createPlanningService(store, complete, directors = createDirectorStore()) {
  const skills = createSkillsStore()
  async function context(input) {
    const { id, step, episode, shot_id: shotId } = input
    if (!validProjectId(id) || !planningSteps.includes(step)) throw invalid('项目或规划步骤无效')
    if (['script', 'storyboard', 'shot-prompt'].includes(step) && (!Number.isInteger(episode) || episode < 1 || episode > 100)) throw invalid('集数无效')
    if (step === 'shot-prompt' && !validShotId(shotId)) throw invalid('镜头 ID 无效')
    const project = await store.read(id), planning = await store.readPlanning(id)
    const series = finalized(planning.series)
    if (step !== 'series' && !series) throw conflict('请先定稿立项')
    if (episode && episode > series?.episode_count) throw invalid('集数超出立项范围')
    const outline = finalized(planning.outline)
    if (['script', 'storyboard', 'shot-prompt'].includes(step) && !outline) throw conflict('请先定稿大纲')
    const script = finalized(planning.episodes[episode]?.script)
    if (['storyboard', 'shot-prompt'].includes(step) && !script) throw conflict('请先定稿剧本')
    const storyboard = finalized(planning.episodes[episode]?.storyboard)
    if (step === 'shot-prompt' && !storyboard) throw conflict('请先定稿分镜')
    if (step === 'shot-prompt' && !storyboard.shots.some(shot => shot.id === shotId)) throw invalid('镜头不属于当前集分镜')
    return { project, planning, series, outline, script, storyboard }
  }
  async function prompt(input, state) {
    const base = await skills.get('drama-planning')
    const director = await directors.get(state.project.director)
    const part = `steps/${input.step}.md`
    const stepText = await skills.reference(director.name, part).catch(error => {
      if (error.code !== 'ENOENT') throw error
      return skills.reference('drama-planning', part)
    })
    const checklist = await skills.reference('drama-planning', 'checklist.md')
    const user = JSON.stringify({ project: { title: state.project.title, genre: state.project.genre, synopsis: state.project.synopsis },
      episode: input.episode, shot_id: input.shot_id, requirements: input.request || '',
      series: state.series, outline: state.outline, script: state.script, storyboard: state.storyboard })
    return { name: `drama_${input.step.replace('-', '_')}`, schema: planningSchema[input.step], llm: base.metadata?.llm,
      system: [base.content, director.content, stepText, checklist].join('\n\n'), user }
  }
  const generate = async input => {
    const state = await context(input)
    if (input.request !== undefined && (typeof input.request !== 'string' || input.request.length > 20000)) throw invalid('补充要求无效')
    const result = await complete(await prompt(input, state))
    validatePlanningResult(input.step, result, { series: state.series })
    if (input.step === 'storyboard') for (const shot of result.shots) shot.id = randomBytes(4).toString('hex')
    return store.appendPlanningVersion(input.id, input.step, input.episode, input.shot_id, result, input.request || '')
  }
  const edit = async input => {
    const state = await context(input)
    validatePlanningResult(input.step, input.value, { series: state.series })
    if (input.step === 'storyboard') for (const shot of input.value.shots) shot.id ||= randomBytes(4).toString('hex')
    return store.appendPlanningVersion(input.id, input.step, input.episode, input.shot_id, input.value, '手动修改')
  }
  const finalize = async input => {
    const state = await context(input)
    if (!Number.isInteger(input.version) || input.version < 1) throw invalid('规划版本无效')
    const planning = await store.finalizePlanningVersion(input.id, input.step, input.episode, input.shot_id, input.version)
    if (input.step === 'series') await store.createAnchorsFromCast(input.id, finalized(planning.series))
    if (input.step === 'storyboard' && state.planning.episodes[input.episode]?.storyboard?.finalized !== input.version) {
      const value = finalized(planning.episodes[input.episode].storyboard)
      const anchors = (await store.read(input.id)).anchors
      const shots = value.shots.map(shot => {
        const role = shot.roles[0] || ''
        const anchor = anchors.find(item => item.role === role)
        return { id: shot.id, role, roles: shot.roles, scene: shot.scene_id, shot_size: shot.shot_size, camera: shot.camera,
          action: shot.action, duration: shot.duration, dialogue: shot.dialogue, subtitle: shot.dialogue.map(line => line.text).join(' '),
          mode: anchor?.source?.job_id ? 'i2va' : 't2va', job_id: null, status: 'pending', notes: '', prompt: '', prompt_finalized: false }
      })
      await store.saveEpisodeStoryboard(input.id, input.episode, [{ title: `第 ${input.episode} 集`, shots }])
    }
    if (input.step === 'shot-prompt') {
      const value = finalized(planning.episodes[input.episode].prompts[input.shot_id])
      await store.changeShot(input.id, 'update', { episode: input.episode, id: input.shot_id, prompt: value.prompt, prompt_finalized: true })
    }
    return planning
  }
  const read = async ({ id }) => {
    if (!validProjectId(id)) throw invalid('项目 ID 无效')
    return store.readPlanning(id)
  }
  return { generate, edit, finalize, read }
}
