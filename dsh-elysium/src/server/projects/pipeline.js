// 职责：自动生产流水线：逐 tick 对账已开启项目，推进规划定稿、镜头提交、失败重拍与本集合成。
import { createHash } from 'node:crypto'
import { readdir } from '../../database/files.js'
import { projectsRoot } from '../../database/paths.js'
import { planningBasis } from '../../database/managers/projects.js'
import { validProjectId } from '../../database/schemas/projects.js'
import { getJob } from '../../worker/index.js'

const finalizedValue = entry => entry?.versions.find(item => item.version === entry.finalized)?.value
const pending = entry => !entry?.finalized || entry.needs_review
const busy = status => ['pending', 'queued', 'running'].includes(status)
const shotsOf = episode => episode.acts.flatMap(act => act.shots)
const filmIdOf = (id, episode, jobIds) => createHash('sha256').update(JSON.stringify([id, episode, jobIds])).digest('hex').slice(0, 32)
const labels = { timeline: '时间线', storyboard: '分镜', 'shot-prompt': '提示词' }

// 规划步骤按集升序，每集 时间线 → 分镜 → 逐镜提示词；返回首个待处理步骤。
function nextPlanningStep(planning, last) {
  for (let episode = 1; episode <= last; episode++) {
    const entry = planning.episodes[episode] || {}
    for (const step of ['timeline', 'storyboard']) if (pending(entry[step])) return { step, episode, entry: entry[step] }
    for (const shot of finalizedValue(entry.storyboard).shots) {
      const prompt = entry.prompts?.[shot.id]
      if (pending(prompt)) return { step: 'shot-prompt', episode, shot_id: shot.id, entry: prompt }
    }
  }
  return null
}

const planningReady = (planning, episode) => {
  const entry = planning.episodes[episode] || {}
  return !pending(entry.timeline) && !pending(entry.storyboard) && finalizedValue(entry.storyboard).shots.every(shot => !pending(entry.prompts?.[shot.id]))
}

export function createPipelineDriver(store, logger = console) {
  let thinking = null
  const pause = (id, paused) => store.changeAuto(id, auto => ({ ...auto, paused }))
  const count = (id, key) => store.changeAuto(id, auto => ({ ...auto, attempts: { ...auto.attempts, [key]: (auto.attempts[key] || 0) + 1 } }))
  const forget = (id, key) => store.changeAuto(id, auto => { delete auto.attempts[key]; return auto })

  // 优先定稿已基于当前上游的最新版本，否则生成新版本；定稿前若运营已处理则放弃。
  async function advance(id, { step, episode, shot_id: shotId }) {
    const key = { id, step, episode, shot_id: shotId }
    const entryOf = planning => step === 'shot-prompt' ? planning.episodes[episode]?.prompts?.[shotId] : planning.episodes[episode]?.[step]
    const before = await store.readPlanning(id), latest = entryOf(before)?.versions.at(-1)
    let version = latest && latest.version !== entryOf(before).finalized && JSON.stringify(latest.based_on) === JSON.stringify(planningBasis(before, step, episode)) ? latest.version : null
    if (!version) version = entryOf(await store.planning.generate(key)).versions.at(-1).version
    const current = entryOf(await store.readPlanning(id))
    if ((current.finalized ?? null) !== (entryOf(before)?.finalized ?? null) && !current.needs_review) return
    await store.planning.finalize({ ...key, version })
    await forget(id, `plan/${step}/${episode}/${shotId || ''}`)
  }

  function think(id, work, location) {
    thinking = advance(id, work).catch(async error => {
      if (error.status === 409) return
      const key = `plan/${work.step}/${work.episode}/${work.shot_id || ''}`
      const project = await store.read(id)
      if ((project.auto.attempts[key] || 0) < 1) return count(id, key)
      await pause(id, { reason: `第 ${work.episode} 集${labels[work.step]}生成失败：${error.message}`, ...location })
    }).catch(error => logger?.error?.(`[elysium] pipeline ${id}: ${error.message}`)).finally(() => { thinking = null })
  }

  // 角色锚点图失败时自动重出一次，仍失败则暂停；返回锚点是否全部就绪。
  async function anchorsReady(project) {
    let ready = true
    for (const anchor of project.anchors.filter(item => item.kind === 'character' && !item.retired)) {
      const job = anchor.image_job_id ? await getJob(anchor.image_job_id) : null
      if (anchor.source && !anchor.image_needs_review) {
        if (project.auto.attempts[`anchor/${anchor.role}`]) await forget(project.id, `anchor/${anchor.role}`)
        continue
      }
      ready = false
      if (busy(job?.status)) continue
      const key = `anchor/${anchor.role}`
      if (job && project.auto.attempts[key]) {
        await pause(project.id, { reason: `角色「${anchor.label}」参考图生成失败：${job.error || job.status}`, step: 'anchor' })
        return false
      }
      if (job) await count(project.id, key)
      await store.generateAnchorImage({ project_id: project.id, role: anchor.role })
    }
    return ready
  }

  // 生产一集；返回 true 表示本集成片与当前镜头一致。
  async function produce(project, episode) {
    const current = await store.readEpisode(project.id, episode), shots = shotsOf(current)
    for (const shot of shots) {
      const where = { episode, step: 'shot', shot_id: shot.id }, key = `${episode}/${shot.id}`
      if (['failed', 'cancelled'].includes(shot.status)) {
        if ((project.auto.attempts[key] || 0) >= 1) {
          const job = await getJob(shot.job_id).catch(() => null), keyframe = await getJob(shot.keyframe_job_id).catch(() => null)
          const reason = keyframe?.status === 'failed' ? `首帧失败：${keyframe.error || ''}` : job?.error || shot.status
          await pause(project.id, { reason: `第 ${episode} 集镜头 ${shot.id} 生成失败：${reason}`, ...where })
          return false
        }
        await store.reshootShot({ project_id: project.id, episode, shot_id: shot.id })
        await count(project.id, key)
        return false
      }
      if (!shot.job_id) {
        try { await store.produceShot({ project_id: project.id, episode, shot_id: shot.id }) }
        catch (error) { await pause(project.id, { reason: `第 ${episode} 集镜头 ${shot.id} 无法提交：${error.message}`, ...where }); return false }
      }
    }
    if (shots.some(shot => shot.status !== 'succeeded')) return false
    const jobIds = shots.map(shot => shot.job_id), filmId = filmIdOf(project.id, episode, jobIds)
    if (current.deliverables.some(item => item.job_id === filmId)) return true
    const task = current.film_task
    if (task?.task_id === filmId && task.status === 'failed') {
      if ((project.auto.attempts[`film/${episode}`] || 0) >= 1) {
        await pause(project.id, { reason: `第 ${episode} 集合成失败：${task.error}`, episode, step: 'film' })
        return false
      }
      await count(project.id, `film/${episode}`)
    } else if (task?.task_id === filmId) return false
    await store.requestEpisodeFilm(project.id, episode)
    return false
  }

  async function reconcile(id) {
    const project = await store.read(id), auto = project.auto
    if (!auto.enabled || auto.paused) return false
    const planning = await store.readPlanning(id), series = finalizedValue(planning.series)
    if (!series || planning.series.needs_review) {
      await pause(id, { reason: '剧情总览尚未定稿或需复核，请先定稿', step: 'series' })
      return false
    }
    const last = Math.min(auto.until_episode ?? series.episode_count, series.episode_count)
    const next = nextPlanningStep(planning, last)
    if (next && next.entry?.needs_review && !auto.cascade_confirmed) {
      const produced = shotsOf(await store.readEpisode(id, next.episode)).filter(shot => shot.job_id).length
      if (produced) {
        await pause(id, { reason: `第 ${next.episode} 集上游已变更，继续将重新生成${labels[next.step]}并重拍受影响镜头（本集已生成 ${produced} 镜）`,
          episode: next.episode, step: 'cascade' })
        return false
      }
    }
    if (next && !thinking) think(id, next, { episode: next.episode, step: next.step, ...(next.shot_id ? { shot_id: next.shot_id } : {}) })
    if (!await anchorsReady(project)) return true
    // 等待运营确认锚点时只在还有规划要做时保持高频对账。
    if (!auto.anchors_confirmed) return Boolean(next)
    let done = !next
    for (let episode = 1; episode <= last; episode++) {
      if (!planningReady(planning, episode)) { done = false; break }
      if (!await produce(await store.read(id), episode)) done = false
      if ((await store.read(id)).auto.paused) return false
    }
    if (done && auto.cascade_confirmed) await store.changeAuto(id, value => ({ ...value, cascade_confirmed: false }))
    return !done
  }

  return async () => {
    const entries = await readdir(projectsRoot(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    let active = Boolean(thinking)
    for (const entry of entries) {
      if (!entry.isDirectory() || !validProjectId(entry.name) || entry.name === '00000000') continue
      try { if (await reconcile(entry.name)) active = true }
      catch (error) { if (error.code !== 'ENOENT') logger?.error?.(`[elysium] pipeline ${entry.name}: ${error.message}`) }
    }
    return { active }
  }
}
