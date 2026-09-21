// 职责：按通用与导演 Skill 生成五步剧情规划，并管理审核版本。
import { createSkillsStore } from '../../database/managers/skills.js'
import { createDirectorStore } from '../../database/managers/directors.js'
import { validProjectId, validShotId } from '../../database/schemas/projects.js'
import { statusError } from '../../utils/errors.js'
import { planningSchema, planningSteps, projectDraftSchema, validatePlanningResult, validateProjectDraft } from './planning-schema.js'
import { randomBytes } from 'node:crypto'

const invalid = message => statusError(400, message)
const conflict = message => statusError(409, message)
const finalized = entry => entry?.versions.find(item => item.version === entry.finalized)?.value
const basis = (step, state, episode) => step === 'series' ? {} : step === 'timeline' ? {
  series: state.planning.series.finalized,
  previous_timeline: state.planning.episodes[String(episode - 1)]?.timeline?.versions.at(-1)?.version ?? null,
} : step === 'storyboard' ? { timeline: state.planning.episodes[episode]?.timeline?.finalized ?? null }
  : { storyboard: state.planning.episodes[episode]?.storyboard?.finalized ?? null }
const optionalReference = (skills, name, path) => skills.reference(name, path).catch(error => {
  if (error.code === 'ENOENT') return ''
  throw error
})
const shotKey = shot => JSON.stringify([shot.scene_id ?? shot.scene, shot.roles, shot.action, shot.dialogue])

function preserveShots(next, previous) {
  const old = previous.flatMap(act => act.shots), before = old.map(shotKey), after = next.map(shotKey)
  const lengths = Array.from({ length: old.length + 1 }, () => Array(next.length + 1).fill(0))
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--)
    lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
  const matches = new Map()
  for (let i = 0, j = 0; i < old.length && j < next.length;) {
    if (before[i] === after[j]) { matches.set(j, old[i]); i++; j++ }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++
    else j++
  }
  return next.map((shot, index) => ({ ...shot, id: matches.get(index)?.id || randomBytes(4).toString('hex'), previous: matches.get(index) }))
}

export function createPlanningService(store, complete, directors = createDirectorStore()) {
  const skills = createSkillsStore()
  const suggestProject = async input => {
    const name = input?.director
    if (typeof name !== 'string' || !name.trim()) throw invalid('请选择项目导演')
    const director = await directors.get(name)
    const base = await skills.get('drama-planning')
    const script = await optionalReference(skills, director.name, 'script.md')
    const result = await complete({ name: 'project_draft', schema: projectDraftSchema, llm: base.metadata?.llm,
      system: [base.content, director.content, script, '根据导演风格构思一个适合制作人物短剧的原创项目。仅输出项目名称 title、项目题材 genre、故事梗概 synopsis。故事梗概须交代主角、核心冲突和故事走向；不要生成剧本、分镜或封面。'].filter(Boolean).join('\n\n'),
      user: JSON.stringify({ director: director.display_name }) })
    return validateProjectDraft(result)
  }
  async function context(input) {
    const { id, step, episode, shot_id: shotId } = input
    if (!validProjectId(id) || !planningSteps.includes(step)) throw invalid('项目或规划步骤无效')
    if (['timeline', 'storyboard', 'shot-prompt'].includes(step) && (!Number.isInteger(episode) || episode < 1 || episode > 100)) throw invalid('集数无效')
    if (step === 'shot-prompt' && !validShotId(shotId)) throw invalid('镜头 ID 无效')
    const project = await store.read(id), planning = await store.readPlanning(id)
    const series = finalized(planning.series)
    if (step !== 'series' && !series) throw conflict('请先定稿剧情总览')
    if (episode && episode > series?.episode_count) throw invalid('集数超出剧情总览范围')
    const timeline = finalized(planning.episodes[episode]?.timeline)
    if (['storyboard', 'shot-prompt'].includes(step) && !timeline) throw conflict('请先定稿本集时间线')
    const storyboard = finalized(planning.episodes[episode]?.storyboard)
    if (step === 'shot-prompt' && !storyboard) throw conflict('请先定稿分镜')
    if (step === 'shot-prompt' && !storyboard.shots.some(shot => shot.id === shotId)) throw invalid('镜头不属于当前集分镜')
    const previousTimeline = planning.episodes[String(episode - 1)]?.timeline?.versions.at(-1)?.value
    return { project, planning, series, timeline, previousTimeline, storyboard,
      shot: storyboard?.shots.find(shot => shot.id === shotId) }
  }
  async function prompt(input, state) {
    const skillName = ['series', 'timeline'].includes(input.step) ? 'drama-planning' : 'shot-planning'
    const base = await skills.get(skillName)
    const director = await directors.get(state.project.director)
    const part = `steps/${input.step}.md`
    const stepText = await skills.reference(skillName, part)
    const directorStep = await optionalReference(skills, director.name, ['series', 'timeline'].includes(input.step) ? 'script.md' : 'storyboard.md')
    const checklist = await skills.reference(skillName, 'checklist.md')
    const example = input.step === 'shot-prompt'
      ? await optionalReference(skills, director.name, 'shot-prompt-example.md') || await skills.reference(skillName, 'shot-prompt-example.md') : ''
    const user = JSON.stringify({ project: { title: state.project.title, genre: state.project.genre, synopsis: state.project.synopsis },
      episode: input.episode, shot_id: input.shot_id, requirements: input.request || '',
      series: state.series, episode_summary: state.series?.episodes?.[input.episode - 1], previous_timeline: state.previousTimeline,
      timeline: state.timeline, storyboard: state.storyboard })
    return { name: `drama_${input.step.replace('-', '_')}`, schema: planningSchema[input.step], llm: base.metadata?.llm,
      system: [base.content, director.content, stepText, directorStep, example, checklist].filter(Boolean).join('\n\n'), user }
  }
  const generate = async input => {
    const state = await context(input)
    if (input.request !== undefined && (typeof input.request !== 'string' || input.request.length > 20000)) throw invalid('补充要求无效')
    const result = await complete(await prompt(input, state))
    validatePlanningResult(input.step, result, { series: state.series, timeline: state.timeline, shot: state.shot })
    if (input.step === 'storyboard') for (const shot of result.shots) shot.id = randomBytes(4).toString('hex')
    return store.appendPlanningVersion(input.id, input.step, input.episode, input.shot_id, result, input.request || '', basis(input.step, state, input.episode))
  }
  const edit = async input => {
    const state = await context(input)
    try { validatePlanningResult(input.step, input.value, { series: state.series, timeline: state.timeline, shot: state.shot }) }
    catch (error) { error.status = 400; throw error }
    if (input.step === 'storyboard') for (const shot of input.value.shots) shot.id ||= randomBytes(4).toString('hex')
    return store.appendPlanningVersion(input.id, input.step, input.episode, input.shot_id, input.value, '手动修改', basis(input.step, state, input.episode))
  }
  const finalize = async input => {
    const state = await context(input)
    if (!Number.isInteger(input.version) || input.version < 1) throw invalid('规划版本无效')
    let replacement
    if (input.step === 'shot-prompt') {
      const shot = (await store.readEpisode(input.id, input.episode)).acts.flatMap(act => act.shots).find(item => item.id === input.shot_id)
      if (!shot) throw conflict('请先定稿本集分镜')
      if (['queued', 'running'].includes(shot.status) || shot.status === 'pending' && shot.job_id) throw conflict('镜头正在生成，完成后再定稿提示词')
    }
    if (input.step === 'storyboard' && state.planning.episodes[input.episode]?.storyboard?.finalized !== input.version) {
      const current = await store.readEpisode(input.id, input.episode)
      if (current.acts.flatMap(act => act.shots).some(shot => ['queued', 'running'].includes(shot.status) || shot.status === 'pending' && shot.job_id)) throw conflict('本集有正在生成的镜头，不能重新定稿分镜')
      const version = state.planning.episodes[input.episode]?.storyboard?.versions.find(item => item.version === input.version)
      if (!version) throw invalid('规划版本不存在')
      replacement = { shots: preserveShots(version.value.shots, current.acts).map(({ previous, ...shot }) => shot) }
    }
    const planning = await store.finalizePlanningVersion(input.id, input.step, input.episode, input.shot_id, input.version, replacement)
    if (input.step === 'series') {
      const { changed } = await store.createAnchorsFromCast(input.id, finalized(planning.series))
      if (changed.length) await store.changeAuto(input.id, auto => ({ ...auto, anchors_confirmed: false }))
      // 出图提交失败不影响定稿：锚点页可手动重试，流水线也会补出图。
      await store.generateAnchorImages(input.id).catch(() => {})
    }
    if (input.step === 'storyboard' && state.planning.episodes[input.episode]?.storyboard?.finalized !== input.version) {
      const value = finalized(planning.episodes[input.episode].storyboard)
      const previous = (await store.readEpisode(input.id, input.episode)).acts.flatMap(act => act.shots)
      const shots = value.shots.map(shot => {
        const old = previous.find(item => item.id === shot.id && shotKey(item) === shotKey(shot))
        return { id: shot.id, roles: shot.roles, scene: shot.scene_id, shot_size: shot.shot_size, camera: shot.camera,
          action: shot.action, duration: shot.duration, dialogue: shot.dialogue, subtitle: shot.dialogue.map(line => line.text).join(' '),
          prompt: old?.prompt || '', keyframe_prompt: old?.keyframe_prompt || '', prompt_finalized: old?.prompt_finalized || false,
          take: old?.take || 0, keyframe_job_id: old?.keyframe_job_id || null, job_id: old?.job_id || null, status: old?.status || 'pending' }
      })
      await store.saveEpisodeStoryboard(input.id, input.episode, [{ title: `第 ${input.episode} 集`, shots }])
    }
    if (input.step === 'shot-prompt') {
      const value = finalized(planning.episodes[input.episode].prompts[input.shot_id])
      const shot = (await store.readEpisode(input.id, input.episode)).acts.flatMap(act => act.shots).find(item => item.id === input.shot_id)
      // 提示词变化后旧画面不再对应定稿内容，镜头回到待生成。
      const stale = shot.job_id && (shot.prompt !== value.prompt || shot.keyframe_prompt !== value.keyframe_prompt)
      if (stale) await store.changeAuto(input.id, auto => { delete auto.attempts[`${input.episode}/${input.shot_id}`]; return auto })
      await store.changeShot(input.id, { episode: input.episode, id: input.shot_id, prompt: value.prompt, keyframe_prompt: value.keyframe_prompt, prompt_finalized: true,
        ...(stale ? { job_id: null, keyframe_job_id: null, status: 'pending' } : {}) })
    }
    return planning
  }
  const read = async ({ id }) => {
    if (!validProjectId(id)) throw invalid('项目 ID 无效')
    return store.readPlanning(id)
  }
  return { suggestProject, generate, edit, finalize, read }
}
