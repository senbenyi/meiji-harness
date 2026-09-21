// 职责：组合 Markdown 项目视图、Skill 生成与图片视频任务提交。
import { createProjectStore as createStore, projectSummary } from '../../database/managers/projects.js'
import { completeStructured, getJob, registerSink, removeProjectTasks, submit, taskId } from '../../worker/index.js'
import { validEpisode, validProjectId, validShotId } from './schema.js'
import { statusError } from '../../utils/errors.js'
import { createPlanningService } from './planning.js'
import { compileShot, shotRoles } from './compile.js'
import { parseProject, parseScript, parseSeries } from './documents.js'
import { createHash } from 'node:crypto'
import { availableJobSummary } from '../media/catalog.js'
import { validJobId } from '../../database/schemas/projects.js'

export { projectSummary }
const invalid = message => statusError(400, message)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
const seed = (submissionId, index) => parseInt(hash([submissionId, index]).slice(0, 8), 16)
const lane = projectId => ({ id: `project-${projectId}-main`, priority: 'batch' })
const running = shot => ['queued', 'running'].includes(shot.status) || shot.status === 'pending' && Boolean(shot.job_id)

function view(raw) {
  const project = parseProject(raw.project_text), series = parseSeries(raw.series_text)
  const episodes = raw.episodes.map(item => {
    const parsed = parseScript(item.script)
    return { ...item, scenes: parsed.scenes, shots: parsed.shots.map(shot => ({ ...shot, cast: shot.roles?.length ? shot.roles : shotRoles(series?.characters || [], shot.lines), ...(raw.state.episodes[item.number]?.shots?.[shot.id] ||
      { take: 0, keyframe_job_id: null, job_id: null, status: 'pending' }) })) }
  })
  return { ...raw, ...project, series, episodes, anchors: raw.state.anchors, auto: raw.state.auto }
}

export function createProjectStore(options = {}) {
  const { submitTasks = submit, complete = completeStructured, ...storeOptions } = options
  const store = createStore({ removeTasks: removeProjectTasks, ...storeOptions })
  const rawRead = store.read, rawEpisode = store.readEpisode, rawChange = store.change, rawSave = store.saveDoc, rawState = store.changeState
  store.read = async id => view(await rawRead(id))
  store.readEpisode = async (id, number) => {
    const project = await store.read(id), episode = project.episodes.find(item => item.number === number)
    return { ...project, episode: number, script: episode?.script || '', shots: episode?.shots || [], film: episode?.film || null,
      film_task: episode?.film_task || null }
  }
  store.change = async (action, body) => action === 'delete' ? rawChange(action, body) : view(await rawChange(action, body))
  store.saveDoc = async (id, step, markdown, number) => view(await rawSave(id, step, markdown, number))
  store.changeState = async (id, update) => view(await rawState(id, update))
  for (const method of ['changeShot', 'changeAuto', 'changeAnchor', 'requestEpisodeFilm', 'updateEpisodeFilmTask', 'addEpisodeFilm']) {
    const original = store[method]
    store[method] = async (id, ...args) => { await original(id, ...args); return store.read(id) }
  }
  store.planning = createPlanningService(store, complete)
  const shotOf = async (id, episode, shotId) => {
    if (!validProjectId(id) || !validEpisode(episode) || !validShotId(shotId)) throw invalid('项目、集数或镜头无效')
    const project = await store.readEpisode(id, episode), shot = project.shots.find(item => item.id === shotId)
    if (!shot) throw invalid('镜头不存在')
    return { project, shot }
  }
  store.generateAnchorImage = async ({ project_id: id, role }) => {
    const project = await store.read(id), character = project.series?.characters.find(item => item.name === role)
    if (!character) throw invalid('角色不存在')
    const current = project.anchors[role]
    if (current?.image_job_id && running({ status: (await getJob(current.image_job_id)).status, job_id: current.image_job_id })) return project
    const submissionId = `anchor-${hash([id, role, character.appearance, current?.source_job_id ? Date.now() : project.auto.attempts[`anchor/${role}`] || 0])}`
    const receipt = await submitTasks({ submission_id: submissionId, lane: lane(id), project_id: id, channel: 'project',
      tasks: [{ kind: 'image', plan: { capability: 'image-generate', params: { prompt: character.appearance, seed: seed(submissionId, 0),
        character: { view: 'front' } } }, binding: { type: 'anchor', role } }] })
    return store.changeAnchor(id, role, { image_job_id: receipt.tasks[0].task_id })
  }
  store.replaceAnchorImage = async ({ id, role, job_id: jobId }) => {
    const project = await store.read(id)
    if (!project.series?.characters.some(item => item.name === role) || !validJobId(jobId) || !(await availableJobSummary(await getJob(jobId))).has_image) throw invalid('定妆图素材无效')
    return store.changeAnchor(id, role, { source_job_id: jobId })
  }
  store.generateAnchorImages = async id => {
    const project = await store.read(id)
    for (const character of project.series?.characters || []) if (!project.anchors[character.name]?.source_job_id) await store.generateAnchorImage({ project_id: id, role: character.name })
    return store.read(id)
  }
  store.produceShot = async ({ project_id: id, episode, shot_id: shotId }) => {
    const { project, shot } = await shotOf(id, episode, shotId)
    if (shot.job_id) throw statusError(409, '镜头已有任务，请先重拍')
    const compiled = compileShot(project.series, shot, project.anchors)
    const submissionId = `shot-${hash([id, episode, shotId, shot.take || 0])}`
    const tasks = [
      { kind: 'image', plan: { capability: 'image-generate', params: { prompt: compiled.keyframe_prompt, seed: seed(submissionId, 0), purpose: 'keyframe',
        ...(compiled.reference_job_id ? { image_path: `job:${compiled.reference_job_id}` } : {}) } }, binding: { type: 'keyframe', shot_id: shotId, episode } },
      { kind: 'video', plan: { mode: 'i2va', prompt: compiled.prompt, first_frame: `job:${taskId(submissionId, 0)}`,
        duration_seconds: compiled.duration, seed: seed(submissionId, 1) }, binding: { type: 'shot', shot_id: shotId, episode } },
    ]
    const receipt = await submitTasks({ submission_id: submissionId, lane: lane(id), project_id: id, channel: 'project', tasks })
    return store.changeShot(id, { episode, id: shotId, take: (shot.take || 0) + 1, keyframe_job_id: receipt.tasks[0].task_id,
      job_id: receipt.tasks[1].task_id, status: 'pending' })
  }
  store.reshootShot = async ({ project_id: id, episode, shot_id: shotId }) => {
    const { shot } = await shotOf(id, episode, shotId)
    if (running(shot)) throw statusError(409, '镜头正在生成')
    await store.changeShot(id, { episode, id: shotId, job_id: null, keyframe_job_id: null, status: 'pending' })
    await store.changeAuto(id, auto => ({ ...auto, task: 'produce', paused: null }))
    return store.readEpisode(id, episode)
  }
  store.produceEpisode = async ({ id, episode }) => {
    const current = await store.readEpisode(id, episode)
    if (!current.shots.length) throw statusError(409, '本集还没有分镜')
    for (const shot of current.shots) if (!shot.job_id) await store.produceShot({ project_id: id, episode, shot_id: shot.id })
    return store.readEpisode(id, episode)
  }
  store.startFill = ({ id }) => store.changeAuto(id, auto => ({ ...auto, task: 'fill', paused: null, attempts: {} }))
  store.startProduce = ({ id }) => store.changeAuto(id, auto => ({ ...auto, task: 'produce', paused: null, attempts: {} }))
  store.pauseAuto = ({ id }) => store.changeAuto(id, auto => ({ ...auto, task: null }))
  store.compileShot = async ({ id, episode, shot_id: shotId }) => {
    const { project, shot } = await shotOf(id, episode, shotId)
    return compileShot(project.series, shot, project.anchors)
  }
  return store
}

export function registerProjectSinks(ctx, store) {
  const register = (type, handler) => ctx.effect(() => registerSink(type, handler), `elysium project ${type} sink`)
  register('shot', (job, task) => store.changeShot(task.project_id, { id: task.binding.shot_id, episode: task.binding.episode,
    expect_job_id: job.job_id, status: job.status }))
  register('keyframe', (job, task) => job.status === 'succeeded' ? null : store.changeShot(task.project_id, { id: task.binding.shot_id,
    episode: task.binding.episode, expect_keyframe_job_id: job.job_id, status: 'failed' }))
  register('anchor', async (job, task) => {
    const current = (await store.read(task.project_id)).anchors[task.binding.role]
    if (current?.image_job_id !== job.job_id || job.status !== 'succeeded') return
    return store.changeAnchor(task.project_id, task.binding.role, { source_job_id: job.job_id })
  })
}
