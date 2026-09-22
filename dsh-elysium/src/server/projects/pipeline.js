// 职责：逐 tick 对账 fill 与 produce，失败重试一次并在 state.json 记录暂停原因。
import { readdir } from '../../database/files.js'
import { projectsRoot } from '../../database/paths.js'
import { validProjectId } from '../../database/schemas/projects.js'
import { getJob } from '../../worker/index.js'

const busy = status => ['pending', 'queued', 'running'].includes(status)
const allDone = episode => episode?.storyboard_ready && episode.shots.length && episode.shots.every(shot => shot.status === 'succeeded' && shot.job_id)

export function createPipelineDriver(store, logger = console) {
  let thinking = null
  const pause = (id, reason, location = {}) => store.changeAuto(id, auto => ({ ...auto, paused: { reason, ...location } }))
  const bump = (id, key) => store.changeAuto(id, auto => ({ ...auto, attempts: { ...auto.attempts, [key]: (auto.attempts[key] || 0) + 1 } }))
  const clear = (id, key) => store.changeAuto(id, auto => { delete auto.attempts[key]; return auto })
  function generate(id, step, episode) {
    const key = `${step}/${episode || ''}`
    thinking = store.planning.generate({ id, step, episode }).then(() => clear(id, key)).catch(async error => {
      const project = await store.read(id)
      if (error.status !== 400 && (project.auto.attempts[key] || 0) < 1) await bump(id, key)
      else await pause(id, `${episode ? `第 ${episode} 集` : ''}${step} 生成失败：${error.message}`, { episode, step })
    }).catch(error => logger?.error?.(`[elysium] fill ${id}: ${error.message}`)).finally(() => { thinking = null })
  }
  async function fill(project) {
    if (!project.series) { if (!thinking) generate(project.id, 'series'); return true }
    for (const episode of project.series.episodes) {
      const current = project.episodes.find(item => item.number === episode.number)
      if (!current?.script) { if (!thinking) generate(project.id, 'script', episode.number); return true }
      if (!current.storyboard_ready) { if (!thinking) generate(project.id, 'storyboard', episode.number); return true }
    }
    if (project.auto.task === 'fill') await store.changeAuto(project.id, auto => ({ ...auto, task: null }))
    return false
  }
  async function anchorsReady(project) {
    for (const role of project.series.characters) {
      const anchor = project.anchors[role.name]
      if (anchor?.source_job_id) continue
      const key = `anchor/${role.name}`, job = anchor?.image_job_id ? await getJob(anchor.image_job_id).catch(() => null) : null
      if (busy(job?.status) || job?.status === 'succeeded') return false
      if (job && (project.auto.attempts[key] || 0) >= 1) { await pause(project.id, `角色「${role.name}」定妆图生成失败：${job.error || job.status}`, { step: 'anchor' }); return false }
      if (job) await bump(project.id, key)
      await store.generateAnchorImage({ project_id: project.id, role: role.name })
      return false
    }
    return true
  }
  async function produceEpisode(project, number) {
    const current = project.episodes.find(item => item.number === number)
    if (!current?.shots.length) { await pause(project.id, `第 ${number} 集还没有分镜`, { episode: number, step: 'storyboard' }); return false }
    for (const shot of current.shots) {
      const key = `${number}/${shot.id}`
      if (['failed', 'cancelled'].includes(shot.status)) {
        if ((project.auto.attempts[key] || 0) >= 1) { await pause(project.id, `第 ${number} 集镜头 ${shot.id} 生成失败`, { episode: number, step: 'shot', shot_id: shot.id }); return false }
        await store.reshootShot({ project_id: project.id, episode: number, shot_id: shot.id }); await bump(project.id, key); return false
      }
      if (!shot.job_id) {
        try { await store.produceShot({ project_id: project.id, episode: number, shot_id: shot.id }) }
        catch (error) { await pause(project.id, `第 ${number} 集镜头 ${shot.id} 无法提交：${error.message}`, { episode: number, step: 'shot', shot_id: shot.id }) }
        return false
      }
      if (shot.status !== 'succeeded') return false
    }
    if (!allDone(current)) return false
    const task = current.film_task
    if (current.film?.job_id && task?.status === 'succeeded' && JSON.stringify(task.job_ids) === JSON.stringify(current.shots.map(shot => shot.job_id))) return true
    if (task?.status === 'failed') {
      const key = `film/${number}`
      if ((project.auto.attempts[key] || 0) >= 1) { await pause(project.id, `第 ${number} 集合成失败：${task.error}`, { episode: number, step: 'film' }); return false }
      await bump(project.id, key)
    }
    if (!task || task.status === 'failed') await store.requestEpisodeFilm(project.id, number)
    return false
  }
  async function reconcile(id) {
    const project = await store.read(id)
    if (!project.auto.task || project.auto.paused) {
      for (const episode of project.episodes) if (allDone(episode) && (!episode.film_task || JSON.stringify(episode.film_task.job_ids) !== JSON.stringify(episode.shots.map(shot => shot.job_id)))) { await store.requestEpisodeFilm(id, episode.number); return true }
      return false
    }
    if (await fill(project)) return true
    if (project.auto.task !== 'produce') return false
    try { await store.validateProduction(id, { anchors: false }) }
    catch (error) { await pause(id, `文档校验失败：${error.message}`, { step: 'storyboard' }); return false }
    if (!await anchorsReady(project)) return true
    try { await store.validateProduction(id) }
    catch (error) { await pause(id, `生产前校验失败：${error.message}`, { step: 'storyboard' }); return false }
    for (const item of project.series.episodes) if (!await produceEpisode(await store.read(id), item.number)) return !(await store.read(id)).auto.paused
    await store.changeAuto(id, auto => ({ ...auto, task: null }))
    return false
  }
  return async () => {
    const entries = await readdir(projectsRoot(), { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))
    let active = Boolean(thinking)
    for (const entry of entries) if (entry.isDirectory() && validProjectId(entry.name) && entry.name !== '00000000') {
      try { if (await reconcile(entry.name)) active = true }
      catch (error) { if (error.code !== 'ENOENT') logger?.error?.(`[elysium] pipeline ${entry.name}: ${error.message}`) }
    }
    return { active }
  }
}
